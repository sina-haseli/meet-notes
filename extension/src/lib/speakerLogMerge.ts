import type { SpeakerInterval } from "../types";

function norm(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Merge the Meet speaker log with the mic self-log, sorted by start then name.
 * The self-log is named after Settings → "Your name"; when Meet shows the same name with
 * different case or spacing ("sina haseli" vs "Sina Haseli"), the self entries take Meet's
 * spelling so one person isn't split into two names (which makes every turn uncertain).
 * Only an exact match after case/space folding is merged — never a merely similar name.
 */
export function mergeSpeakerLogs(
  meetLog: SpeakerInterval[],
  selfLog: SpeakerInterval[],
  participants: string[] = [],
): SpeakerInterval[] {
  const spelling = new Map<string, string>();
  for (const n of [...meetLog.map((e) => e.name), ...participants]) {
    if (!spelling.has(norm(n))) spelling.set(norm(n), n);
  }
  const self = selfLog.map((e) => ({ ...e, name: spelling.get(norm(e.name)) ?? e.name }));
  return [...meetLog.map((e) => ({ ...e })), ...self].sort(
    (x, y) => x.start_ms - y.start_ms || x.name.localeCompare(y.name),
  );
}
