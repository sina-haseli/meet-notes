import { mergeSpeakerLogs } from "../src/lib/speakerLogMerge";

const iv = (name: string, start_ms: number, end_ms: number) => ({ name, start_ms, end_ms });

test("merges and sorts by start, then name", () => {
  const out = mergeSpeakerLogs([iv("Reza", 500, 900)], [iv("sina", 0, 400), iv("sina", 500, 600)]);
  expect(out).toEqual([iv("sina", 0, 400), iv("Reza", 500, 900), iv("sina", 500, 600)]);
});

test("the mic self-log takes the Meet spelling of the same name (case and spaces ignored)", () => {
  const meet = [iv("Sina Haseli", 0, 1000)];
  const self = [iv("sina  haseli ", 100, 900)];
  const out = mergeSpeakerLogs(meet, self);
  expect(new Set(out.map((e) => e.name))).toEqual(new Set(["Sina Haseli"]));
});

test("a different person is never merged into the self name", () => {
  const out = mergeSpeakerLogs([iv("Sina Rezaei", 0, 1000)], [iv("Sina Haseli", 0, 1000)]);
  expect(new Set(out.map((e) => e.name))).toEqual(new Set(["Sina Rezaei", "Sina Haseli"]));
});

test("participant names also count as the Meet spelling", () => {
  const out = mergeSpeakerLogs([], [iv("sina haseli", 0, 500)], ["Sina Haseli"]);
  expect(out).toEqual([iv("Sina Haseli", 0, 500)]);
});

test("inputs are not mutated", () => {
  const self = [iv("sina haseli", 0, 500)];
  mergeSpeakerLogs([iv("Sina Haseli", 0, 1)], self);
  expect(self[0].name).toBe("sina haseli");
});
