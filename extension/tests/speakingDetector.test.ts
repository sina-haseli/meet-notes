import { SpeakingDetector } from "../src/lib/speakingDetector";

test("SpeakingDetector ignores blips and closes after hang", () => {
  const d = new SpeakingDetector("Sina");
  d.push(0.5, 0); d.push(0.0, 100); // 100ms blip: ignored
  for (let t = 1000; t <= 2000; t += 50) d.push(0.5, t); // 1s speech
  d.push(0.0, 2050);
  expect(d.finish(5000)).toEqual([{ name: "Sina", start_ms: 1000, end_ms: 2050 }]);
});
