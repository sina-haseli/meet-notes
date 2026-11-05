import { frameDiff, CHANGE_THRESHOLD } from "../src/lib/frameDiff";

test("frameDiff identical is 0, inverted is 1", () => {
  const a = new Uint8Array([0, 255]);
  expect(frameDiff(a, a)).toBe(0);
  expect(frameDiff(a, new Uint8Array([255, 0]))).toBe(1);
});

test("CHANGE_THRESHOLD is 0.08", () => {
  expect(CHANGE_THRESHOLD).toBe(0.08);
});
