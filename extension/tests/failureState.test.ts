import { stateAfterFailure } from "../src/lib/failureState";

describe("stateAfterFailure", () => {
  it("keeps upload-failed (Retry) while the offscreen doc still holds the recording", () => {
    expect(stateAfterFailure({ offscreenAlive: true, dataKept: true, error: "HTTP 500" })).toEqual({
      state: "upload-failed",
      error: "HTTP 500",
    });
  });

  it("stays upload-failed when the offscreen doc is alive but did not say (retry will find out)", () => {
    expect(stateAfterFailure({ offscreenAlive: true, dataKept: undefined, error: "no reply" }).state).toBe(
      "upload-failed",
    );
  });

  it("goes idle with a 'Recording lost' error when the offscreen doc is gone", () => {
    expect(stateAfterFailure({ offscreenAlive: false, dataKept: undefined, error: "closed" })).toEqual({
      state: "idle",
      error: "Recording lost: closed",
    });
    expect(stateAfterFailure({ offscreenAlive: false, dataKept: true, error: "x" }).state).toBe("idle");
  });

  it("goes idle when the offscreen doc reports nothing is kept", () => {
    expect(stateAfterFailure({ offscreenAlive: true, dataKept: false, error: "no data" })).toEqual({
      state: "idle",
      error: "Recording lost: no data",
    });
  });
});
