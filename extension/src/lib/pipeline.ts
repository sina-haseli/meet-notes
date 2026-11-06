import type { ChunkPlan, CodeSearch, MeetingRecord, ScreenDesc, Step, Turn } from "../types";
import * as realDb from "./db";
import type { Settings } from "./settings";
import { extractKeywords } from "./codeKeywords";
import { searchCode } from "./codeSearch";
import { SERVICES_NOTICE, type PermissionQueryable } from "./servicesSnapshot";
import { assembleChunk, planChunks, PCM_RATE } from "./audioChunks";
import { encodeMp3 } from "./mp3";
import { complete, describeImage, OpenRouterError, transcribeChunk } from "./openrouter";
import { apiFor } from "./provider";
import { mergeChunks, parseChunkOutput, renderTranscriptMd, TranscriptParseError } from "./transcript";
import { assignSpeakers } from "./speakers";
import { buildNotesPrompt, NOTES_MAX_TOKENS, NotesError, splitNotesOutput, stripCodePaths } from "./notes";
import { DESCRIBE_PROMPT, MAX_DESCRIBED, pickEvenly } from "./screens";

export interface PipelineDeps {
  db: Pick<typeof import("./db"), "getMeeting" | "updateMeeting" | "getPcmRange" | "listScreens">;
  settings: () => Promise<Settings>;
  transcribe: typeof transcribeChunk;
  describe: typeof describeImage;
  complete: typeof complete;
  encode: typeof encodeMp3;
  /** The saved services folder, if it can be read without a prompt. */
  codeDir: () => Promise<CodeDir>;
  searchCode: typeof searchCode;
  extractKeywords: typeof extractKeywords;
}

export type CodeDir =
  | { status: "ok"; dir: FileSystemDirectoryHandle }
  | { status: "none" }
  | { status: "no-permission" };

/**
 * The services folder for the code step. Uses only IndexedDB and the handle's own permission
 * query (no chrome.* APIs), so it works in the offscreen document; it never prompts.
 */
export async function resolveCodeDir(
  getHandle: (key: string) => Promise<FileSystemDirectoryHandle | undefined>,
): Promise<CodeDir> {
  let h: FileSystemDirectoryHandle | undefined;
  try {
    h = await getHandle("services");
  } catch {
    // can't tell whether a folder is saved: offer Allow & Retry rather than failing the meeting
    return { status: "no-permission" };
  }
  if (!h) return { status: "none" };
  try {
    const perm = await (h as unknown as PermissionQueryable).queryPermission({ mode: "read" });
    if (perm === "granted") return { status: "ok", dir: h };
  } catch {
    // folder moved/deleted or unreadable: same outcome as a missing permission
  }
  return { status: "no-permission" };
}

/**
 * `settings` is called on every use (never cached). The pipeline runs in the offscreen document,
 * which has no chrome.storage, so the caller supplies how to obtain them (R5: from the background).
 */
export function defaultPipelineDeps(settings: () => Promise<Settings>): PipelineDeps {
  return {
    db: realDb,
    settings,
    transcribe: transcribeChunk,
    describe: describeImage,
    complete,
    encode: encodeMp3,
    codeDir: () => resolveCodeDir(realDb.getHandle),
    searchCode,
    extractKeywords,
  };
}

const MSG_NO_KEY = "Add your API key in Settings, then press Retry.";
const MSG_NO_URL = "Enter your AI provider's API address in Settings, then press Retry.";
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

    // Read at run time so a Retry after fixing Settings uses the new provider, key and models.
    const settings = await deps.settings();
    const api = apiFor(settings);
    if (!api) throw new FriendlyError(MSG_NO_URL, "No valid API address set");
    if (!api.key.trim()) throw new FriendlyError(MSG_NO_KEY, "No API key set");

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
          const { text, cost: c } = await deps.transcribe(api, settings.models.transcribe, mp3);
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
        const { text, cost: c } = await deps.describe(api, settings.models.vision, s.blob, DESCRIBE_PROMPT);
        cost += c;
        described.push({ atMs: s.atMs, description: text });
      }
      await save({ screens: described, costUsd: cost });
    }

    // code: where the meeting's topics live in the services folder (AI suggestion evidence)
    if (!rec!.codeSearch) {
      step = "code";
      await save({ step });
      const patch: Partial<MeetingRecord> = {};
      let codeSearch: CodeSearch;
      if (rec!.type === "daily") codeSearch = { status: "skipped", reason: "daily" };
      else if (!settings.codeSuggestions) codeSearch = { status: "skipped", reason: "off" };
      else if (settings.role !== "technical") codeSearch = { status: "skipped", reason: "not-technical" };
      else {
        const d = await deps.codeDir();
        if (d.status === "none") codeSearch = { status: "skipped", reason: "no-folder" };
        else if (d.status === "no-permission") {
          codeSearch = { status: "skipped", reason: "no-permission" };
          patch.servicesNotice = SERVICES_NOTICE;
        } else {
          try {
            const kw = await deps.extractKeywords(
              api, settings.models.transcribe, renderTranscriptMd(rec!.turns ?? []), rec!.screens ?? [], deps.complete);
            cost += kw.cost;
            const found = await deps.searchCode(d.dir, kw.keywords);
            codeSearch = { status: "done", keywords: kw.keywords, services: found.services, limitHit: found.limitHit };
          } catch (e) {
            if (e instanceof OpenRouterError) throw e;
            // A local search problem must never cost the user their notes. Log only the error
            // itself (never the key, keywords or file text) so the failure is not silent.
            console.warn(
              "Meet Notes: code search failed; continuing without code evidence:",
              e instanceof Error ? `${e.name}: ${e.message}` : String(e),
            );
            codeSearch = { status: "skipped", reason: "error" };
          }
        }
      }
      await save({ ...patch, codeSearch, costUsd: cost });
    }

    // notes
    if (!rec!.notesMd) {
      step = "notes";
      await save({ step });
      const prompt = buildNotesPrompt(
        rec!, renderTranscriptMd(rec!.turns ?? []), rec!.screens ?? [], rec!.servicesContext, rec!.codeSearch);
      const { text, cost: c } = await deps.complete(
        api, settings.models.notes, [{ type: "text", text: prompt }], { maxTokens: NOTES_MAX_TOKENS });
      cost += c;
      await save({ costUsd: cost });
      try {
        const { summaryMd, notesMd } = splitNotesOutput(text);
        // The email summary carries service names only: drop any file path the model put there.
        await save({ summaryMd: stripCodePaths(summaryMd, rec!.codeSearch), notesMd });
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
