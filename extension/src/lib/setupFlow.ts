// First-time setup in the popup: 1 OpenRouter key -> 2 name & role -> 3 services folder
// (technical role only; can be skipped). Pure, so the popup and the settings page agree.
import type { Settings } from "./settings";

export type SetupStep = 1 | 2 | 3;

function keyDone(s: Settings): boolean {
  return s.openrouterKey.trim() !== "";
}
function nameRoleDone(s: Settings): boolean {
  return s.selfName.trim() !== "" && s.role !== "";
}
function folderDone(s: Settings): boolean {
  return s.role === "pm" || s.servicesFolderName !== "" || s.servicesSkipped;
}

/** Whether `step` may be shown: every step before it is complete and it exists for this role. */
function stepValid(s: Settings, step: SetupStep): boolean {
  if (step === 1) return true;
  if (step === 2) return keyDone(s);
  return keyDone(s) && nameRoleDone(s) && s.role === "technical";
}

/**
 * Done when the key, the name, the role and (PM role, or a services folder, or Skip) are set.
 * Step = the first incomplete item, but never lower than the saved `setupStep` while it is valid.
 */
export function setupState(s: Settings): { done: boolean; step: SetupStep } {
  const first: SetupStep | null = !keyDone(s) ? 1 : !nameRoleDone(s) ? 2 : !folderDone(s) ? 3 : null;
  const saved: SetupStep = stepValid(s, s.setupStep) ? s.setupStep : 1;
  if (first === null) {
    const last: SetupStep = s.role === "technical" ? 3 : 2;
    return { done: true, step: Math.max(saved, last) as SetupStep };
  }
  return { done: false, step: Math.max(first, saved) as SetupStep };
}

/** The step after `from`; step 3 exists only for the technical role. Step 2 needs a role to leave. */
export function nextStep(s: Settings, from: SetupStep): SetupStep | "done" {
  if (from === 1) return 2;
  if (from === 2) {
    if (s.role === "technical") return 3;
    if (s.role === "pm") return "done";
    return 2;
  }
  return "done";
}

/** The line under the key field after a check: "Connected · $1.98 left", "Connected", or why not. */
export function keyCheckText(
  res: { ok: true; remainingUsd: number | null } | { ok: false; userMessage: string },
): string {
  // The shared message points to Settings; during setup the key field is right here.
  if (!res.ok) return res.userMessage.replace(/ Check it in Settings, then press Retry\.$/, " Check that you pasted the whole key.");
  return res.remainingUsd === null ? "Connected" : `Connected · $${res.remainingUsd.toFixed(2)} left`;
}
