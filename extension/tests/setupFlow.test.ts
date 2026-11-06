import { describe, it, expect } from "vitest";
import { nextStep, setupState } from "../src/lib/setupFlow";
import { DEFAULT_MODELS, HELPER_URL, type Settings } from "../src/lib/settings";

function settings(patch: Partial<Settings> = {}): Settings {
  return {
    openrouterKey: "",
    selfName: "",
    role: "",
    servicesFolderName: "",
    servicesSkipped: false,
    setupStep: 1,
    setupDone: false,
    models: { ...DEFAULT_MODELS },
    helper: { enabled: false, url: HELPER_URL, token: "" },
    lastType: "technical",
    ...patch,
  };
}

describe("setupFlow", () => {
  it("emptyIsStep1", () => {
    expect(setupState(settings())).toEqual({ done: false, step: 1 });
  });

  it("keyOnlyIsStep2", () => {
    expect(setupState(settings({ openrouterKey: "sk-or-v1-abc" }))).toEqual({ done: false, step: 2 });
    // A blank key is not a key.
    expect(setupState(settings({ openrouterKey: "   " })).step).toBe(1);
  });

  it("nameWithoutRoleIsStillStep2", () => {
    expect(setupState(settings({ openrouterKey: "k", selfName: "Sina" }))).toEqual({ done: false, step: 2 });
  });

  it("pmDoneWithoutFolder", () => {
    const s = settings({ openrouterKey: "k", selfName: "Sina", role: "pm" });
    expect(setupState(s).done).toBe(true);
  });

  it("technicalNeedsFolderOrSkip", () => {
    const base = settings({ openrouterKey: "k", selfName: "Sina", role: "technical" });
    expect(setupState(base)).toEqual({ done: false, step: 3 });
    expect(setupState({ ...base, servicesSkipped: true }).done).toBe(true);
    expect(setupState({ ...base, servicesFolderName: "services" }).done).toBe(true);
  });

  it("nextStepSkips3ForPm", () => {
    expect(nextStep(settings({ role: "pm" }), 1)).toBe(2);
    expect(nextStep(settings({ role: "pm" }), 2)).toBe("done");
    expect(nextStep(settings({ role: "technical" }), 2)).toBe(3);
    expect(nextStep(settings({ role: "technical" }), 3)).toBe("done");
    // No role yet: can't leave step 2.
    expect(nextStep(settings(), 2)).toBe(2);
  });

  it("resumesSavedStep", () => {
    expect(setupState(settings({ openrouterKey: "k", setupStep: 2 }))).toEqual({ done: false, step: 2 });
    // Step 3 is kept while it is still valid (key, name, technical role).
    const s3 = settings({ openrouterKey: "k", selfName: "Sina", role: "technical", setupStep: 3 });
    expect(setupState(s3).step).toBe(3);
  });

  it("savedStepIgnoredWhenNoLongerValid", () => {
    // The key was removed later: back to step 1 even though step 3 was saved.
    expect(setupState(settings({ selfName: "Sina", role: "technical", setupStep: 3 })).step).toBe(1);
    // Step 3 saved, then the role changed to PM: step 3 doesn't exist for PMs.
    expect(setupState(settings({ openrouterKey: "k", role: "pm", setupStep: 3 })).step).toBe(2);
  });
});
