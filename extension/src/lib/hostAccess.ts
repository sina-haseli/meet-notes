// Permission to reach the chosen AI provider. OpenRouter is granted at install (manifest
// host_permissions); any other https address is asked for when the user picks it
// (optional_host_permissions "https://*/*"), so the extension never holds more than it uses.
import { originPattern } from "./provider";

export async function hasHostAccess(baseUrl: string): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: [originPattern(baseUrl)] });
  } catch {
    return false;
  }
}

/** Call straight from a click handler, with no await before it: Chrome needs the user gesture. */
export function requestHostAccess(baseUrl: string): Promise<boolean> {
  try {
    return chrome.permissions.request({ origins: [originPattern(baseUrl)] }).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}
