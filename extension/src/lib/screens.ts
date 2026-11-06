export const MAX_DESCRIBED = 60;

export const DESCRIBE_PROMPT =
  "Describe this screenshot from a screen share in a work meeting, in 1-3 English sentences. " +
  "Say which app or screen it is (give the Figma frame name if visible), the main UI components, " +
  "and any readable titles or labels. Keep English technical terms and on-screen text verbatim " +
  "in Latin script; do not translate or transliterate them. " +
  "Only describe what is actually visible; do not guess or invent anything.";

/** Port of _pick_evenly: k items spread over the list, always keeping the first and last. */
export function pickEvenly<T>(items: T[], k: number): T[] {
  const n = items.length;
  if (k >= n) return items;
  if (k <= 0) return [];
  if (k === 1) return [items[0]];
  const idx = new Set<number>();
  for (let i = 0; i < k; i++) idx.add(Math.round((i * (n - 1)) / (k - 1)));
  return [...idx].sort((a, b) => a - b).map((i) => items[i]);
}
