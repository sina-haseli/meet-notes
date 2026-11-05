// ALL Google Meet DOM knowledge lives in this file.
//
// Written from best knowledge of Meet's DOM WITHOUT access to a live meeting, so the constants below are
// ordered candidate strategies, attribute-based first. Meet's obfuscated class names change every few
// weeks: if speaker names stop appearing in notes, update the three constants marked "UPDATE HERE".
// tests/fixtures/meet-speaking.html is a SYNTHETIC fixture mirroring these selectors, not a Meet capture.

// ---- UPDATE HERE (1/3): participant tiles / list rows. Any match is a participant container. ----
const TILE_SELECTORS = ["[data-participant-id]", "[data-requested-participant-id]"];

// ---- UPDATE HERE (2/3): where a tile's display name lives, tried in order. ----
// "attr:X" = value of attribute X on the first descendant (or the tile) that has it; otherwise a CSS
// selector whose element text is the name. Class names (zWGUib, XWGOtd, notranslate) are obfuscated guesses.
const NAME_STRATEGIES = ["attr:data-self-name", "attr:data-tooltip-name", ".zWGUib", ".XWGOtd", ".notranslate"];

// ---- UPDATE HERE (3/3): "this tile is speaking" signals. Any one true marks the tile as speaking. ----
// Attribute signals: [selector, attribute, value-that-means-speaking]. Selector "" means the tile itself.
const SPEAKING_ATTRS: Array<[string, string, string]> = [
  ["", "data-is-speaking", "true"],
  ["[data-is-speaking]", "data-is-speaking", "true"],
  ["[data-audio-level]", "data-audio-level-active", "true"],
];
// Class signals: a tile descendant carrying one of these classes is the animated audio indicator.
// Obfuscated guess; verify in DevTools (see the verification guide in the task report).
const SPEAKING_CLASSES = ["gjg47c"];

// Non-name UI strings that the loose name strategies can pick up (compared lowercase).
const UI_STRINGS = new Set([
  "you", "presentation", "your presentation", "presenting", "pin", "unpin", "mute", "unmute",
  "more options", "host", "(you)", "visual effects", "remove", "dismiss",
]);
const MAX_NAME_LEN = 100;

function cleanName(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s || s.length > MAX_NAME_LEN || UI_STRINGS.has(s.toLowerCase())) return null;
  return s;
}

function tiles(root: Document): Element[] {
  return [...root.querySelectorAll(TILE_SELECTORS.join(","))];
}

function nameOf(tile: Element): string | null {
  for (const strat of NAME_STRATEGIES) {
    if (strat.startsWith("attr:")) {
      const attr = strat.slice(5);
      const el = tile.hasAttribute(attr) ? tile : tile.querySelector(`[${attr}]`);
      const n = cleanName(el?.getAttribute(attr));
      if (n) return n;
    } else {
      for (const el of tile.querySelectorAll(strat)) {
        const n = cleanName(el.textContent);
        if (n) return n;
      }
    }
  }
  return null;
}

function isSpeaking(tile: Element): boolean {
  for (const [sel, attr, val] of SPEAKING_ATTRS) {
    const el = sel === "" ? tile : tile.querySelector(sel);
    if (el?.getAttribute(attr) === val) return true;
  }
  return SPEAKING_CLASSES.some((c) => tile.querySelector(`.${c}`) !== null);
}

/** Names of participants currently marked as speaking. Never throws. */
export function getSpeakingNames(root: Document): Set<string> {
  const out = new Set<string>();
  try {
    for (const tile of tiles(root)) {
      if (!isSpeaking(tile)) continue;
      const n = nameOf(tile);
      if (n) out.add(n);
    }
  } catch {
    return new Set();
  }
  return out;
}

/** Distinct participant display names in DOM order. Never throws. */
export function getParticipantNames(root: Document): string[] {
  const out: string[] = [];
  try {
    for (const tile of tiles(root)) {
      const n = nameOf(tile);
      if (n && !out.includes(n)) out.push(n);
    }
  } catch {
    return [];
  }
  return out;
}
