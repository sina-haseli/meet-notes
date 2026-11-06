import type { ChunkPlan, MeetingRecord, ScreenDesc, Step, Turn } from "../types";
import * as realDb from "./db";
import { getSettings, type Settings } from "./settings";
import { assembleChunk, planChunks, PCM_RATE } from "./audioChunks";
import { encodeMp3 } from "./mp3";
import { complete, describeImage, OpenRouterError, transcribeChunk } from "./openrouter";
import { mergeChunks, parseChunkOutput, renderTranscriptMd, TranscriptParseError } from "./transcript";
import { assignSpeakers } from "./speakers";
import { buildNotesPrompt, NOTES_MAX_TOKENS, NotesError, splitNotesOutput } from "./notes";
import { DESCRIBE_PROMPT, MAX_DESCRIBED, pickEvenly } from "./screens";

export interface PipelineDeps {
  db: Pick<typeof import("./db"), "getMeeting" | "updateMeeting" | "getPcmRange" | "listScreens">;
  settings: () => Promise<Settings>;
  transcribe: typeof transcribeChunk;
  describe: typeof describeImage;
  complete: typeof complete;
  encode: typeof encodeMp3;
}

export function defaultPipelineDeps(): PipelineDeps {
  return {
    db: realDb,
    settings: () => getSettings(),
    transcribe: transcribeChunk,
    describe: describeImage,
    complete,
    encode: encodeMp3,
  };
}

const MSG_NO_KEY = "Add your OpenRouter key in Settings, then press Retry.";
const MSG_NOTES = "The notes came back in an unexpected format. Press Retry.";

class FriendlyError extends Error {
  constructor(public userMessage: string, public detail: string) {
    super(detail);
  }
}

export async function processMeeting(id: string, deps: PipelineDeps): Promise<MeetingRecord> {
  const { db } = deps;
  let step: Step = "chunking";
  let rec: MeetingRecord | undefined;
  let cost = 0;

  const save = async (patch: Partial<MeetingRecord>): Promise<void> => {
    rec = await db.updateMeeting(id, patch);
  };

  try {
    const first = await db.getMeeting(id);
    if (!first) throw new Error(`meeting not found: ${id}`);
    rec = first;
    cost = first.costUsd ?? 0;
    await save({ status: "processing", error: undefined, errorDetail: undefined, step });

    // Read at run time so a Retry after fixing Settings uses the new key and models.
    const settings = await deps.settings();
    const key = settings.openrouterKey;
    if (!key.trim()) throw new FriendlyError(MSG_NO_KEY, "No OpenRouter key set");

    // chunking
    if (!rec!.chunks) {
      const chunks = planChunks(rec!.pcmSamples / (PCM_RATE / 1000));
      await save({ chunks, chunkTurns: chunks.map(() => null) });
    }

    // transcribing
    step = "transcribing";
    await save({ step });
    const chunks = rec!.chunks as ChunkPlan[];
    const chunkTurns: (Turn[] | null)[] = [...(rec!.chunkTurns ?? chunks.map(() => null))];
    for (let i = 0; i < chunks.length; i++) {
      if (chunkTurns[i] !== null && chunkTurns[i] !== undefined) continue;
      const chunk = chunks[i];
      if (chunk.durationMs <= 0) {
        chunkTurns[i] = []; // R4: nothing to transcribe
      } else {
        const pcm = await assembleChunk(chunk, (from, to) => db.getPcmRange(id, from, to));
        const mp3 = deps.encode(pcm);
        let parsed: Turn[] | null = null;
        for (let attempt = 0; attempt < 2 && parsed === null; attempt++) {
          const { text, cost: c } = await deps.transcribe(key, settings.models.transcribe, mp3);
          cost += c;
          try {
            parsed = parseChunkOutput(text, chunk);
          } catch (e) {
            if (!(e instanceof TranscriptParseError)) throw e;
            if (attempt === 1) {
              throw new FriendlyError(
                `The transcription of part ${i + 1} came back unreadable. Press Retry.`, e.message);
            }
          }
        }
        chunkTurns[i] = parsed;
      }
      await save({ chunkTurns: [...chunkTurns], costUsd: cost });
    }

    // speakers
    if (!rec!.turns) {
      step = "speakers";
      await save({ step });
      const turns = assignSpeakers(mergeChunks(chunkTurns as Turn[][]), rec!.speakerLog);
      await save({ turns, costUsd: cost });
    }

    // screens
    if (!rec!.screens) {
      step = "screens";
      await save({ step });
      const shots = pickEvenly(await db.listScreens(id), MAX_DESCRIBED);
      const described: ScreenDesc[] = [];
      for (const s of shots) {
        const { text, cost: c } = await deps.describe(key, settings.models.vision, s.blob, DESCRIBE_PROMPT);
        cost += c;
        described.push({ atMs: s.atMs, description: text });
      }
      await save({ screens: described, costUsd: cost });
    }

    // notes
    if (!rec!.notesMd) {
      step = "notes";
      await save({ step });
      const prompt = buildNotesPrompt(rec!, renderTranscriptMd(rec!.turns ?? []), rec!.screens ?? [], rec!.servicesContext);
      const { text, cost: c } = await deps.complete(
        key, settings.models.notes, [{ type: "text", text: prompt }], { maxTokens: NOTES_MAX_TOKENS });
      cost += c;
      await save({ costUsd: cost });
      try {
        const { summaryMd, notesMd } = splitNotesOutput(text);
        await save({ summaryMd, notesMd });
      } catch (e) {
        if (e instanceof NotesError) throw new FriendlyError(MSG_NOTES, e.message);
        throw e;
      }
    }

    await save({ status: "ready", step: "done", readyAt: Date.now(), costUsd: cost });
    return rec!;
  } catch (e) {
    let error: string;
    let errorDetail: string;
    if (e instanceof FriendlyError || e instanceof OpenRouterError) {
      error = e.userMessage;
      errorDetail = e.detail;
    } else {
      error = `Something went wrong while processing (${step}). Press Retry.`;
      errorDetail = e instanceof Error ? e.message : String(e);
    }
    try {
      await save({ status: "error", error, errorDetail, costUsd: cost });
    } catch {
      // record missing or storage failure: fall through with what we have
    }
    return rec ?? ({ id, status: "error", error, errorDetail, costUsd: cost } as MeetingRecord);
  }
}
