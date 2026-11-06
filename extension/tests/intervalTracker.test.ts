import { IntervalTracker } from "../src/lib/intervalTracker";

test("IntervalTracker opens/closes per name and closes open ones on finish", () => {
  const t = new IntervalTracker();
  t.update(new Set(["Reza"]), 0); t.update(new Set(["Reza", "Sara"]), 1000); t.update(new Set(["Sara"]), 2000);
  expect(t.finish(3000)).toEqual([{ name: "Reza", start_ms: 0, end_ms: 2000 }, { name: "Sara", start_ms: 1000, end_ms: 3000 }]);
});

test("a pause within the merge gap continues the same interval", () => {
  const t = new IntervalTracker();
  t.update(new Set(["Reza"]), 0);
  t.update(new Set(), 1000); // stops...
  t.update(new Set(["Reza"]), 1800); // ...and restarts 800 ms later
  t.update(new Set(), 3000);
  t.update(new Set(), 6000);
  expect(t.finish(7000)).toEqual([{ name: "Reza", start_ms: 0, end_ms: 3000 }]);
});

test("a pause longer than the merge gap starts a new interval", () => {
  const t = new IntervalTracker();
  t.update(new Set(["Reza"]), 0);
  t.update(new Set(), 1000);
  t.update(new Set(["Reza"]), 2500);
  expect(t.finish(4000)).toEqual([
    { name: "Reza", start_ms: 0, end_ms: 1000 },
    { name: "Reza", start_ms: 2500, end_ms: 4000 },
  ]);
});

test("the merge gap is configurable (0 = no merging)", () => {
  const t = new IntervalTracker(0);
  t.update(new Set(["Reza"]), 0);
  t.update(new Set(), 1000);
  t.update(new Set(["Reza"]), 1200);
  expect(t.finish(2000)).toHaveLength(2);
});
