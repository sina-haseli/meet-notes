import type { Settings } from "./settings";

export interface CodeSwitchState {
  checked: boolean;
  disabled: boolean;
  hint: string | null;
}

/** State of the "Suggest where to change the code" switch on the Settings page. */
export function codeSwitchState(s: Settings, hasFolder: boolean): CodeSwitchState {
  // A disabled switch never shows as on: the search cannot run then, whatever is stored.
  if (!hasFolder) return { checked: false, disabled: true, hint: "Choose a services folder first." };
  if (s.role !== "technical") return { checked: false, disabled: true, hint: "Only for the Technical role." };
  return { checked: s.codeSuggestions, disabled: false, hint: null };
}
