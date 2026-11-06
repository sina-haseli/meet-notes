import type { Settings } from "./settings";

export interface CodeSwitchState {
  checked: boolean;
  disabled: boolean;
  hint: string | null;
}

/** State of the "Suggest where to change the code" switch on the Settings page. */
export function codeSwitchState(s: Settings, hasFolder: boolean): CodeSwitchState {
  const checked = s.codeSuggestions;
  if (!hasFolder) return { checked, disabled: true, hint: "Choose a services folder first." };
  if (s.role !== "technical") return { checked, disabled: true, hint: "Only for the Technical role." };
  return { checked, disabled: false, hint: null };
}
