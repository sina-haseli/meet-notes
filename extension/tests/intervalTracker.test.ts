import { IntervalTracker } from "../src/lib/intervalTracker";

test("IntervalTracker opens/closes per name and closes open ones on finish", () => {
  const t = new IntervalTracker();
  t.update(new Set(["Reza"]), 0); t.update(new Set(["Reza", "Sara"]), 1000); t.update(new Set(["Sara"]), 2000);
  expect(t.finish(3000)).toEqual([{ name: "Reza", start_ms: 0, end_ms: 2000 }, { name: "Sara", start_ms: 1000, end_ms: 3000 }]);
});
