export const CHANGE_THRESHOLD = 0.08;

/** Mean absolute difference of two equal-length grayscale thumbnails, normalized to 0..1. */
export function frameDiff(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) throw new Error("frameDiff: length mismatch");
  if (a.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / (a.length * 255);
}
