import { localIso } from "../src/lib/localIso";

describe("localIso", () => {
  it("formats local time with the UTC offset and round-trips to the same instant", () => {
    const ms = Date.UTC(2026, 10, 6, 9, 5, 7, 42);
    const s = localIso(ms);
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    expect(new Date(s).getTime()).toBe(ms);
  });
});
