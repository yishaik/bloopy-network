import { describe, expect, it } from "vitest";
import { configuredPlatformAvailable, estimateNarrativeCostMicrousd, shouldSampleRoutineScene } from "../src/ai-policy.js";

describe("AI policy",()=>{
  it("estimates platform cost in integer microdollars",()=>{
    expect(estimateNarrativeCostMicrousd(1000,100)).toBe(190);
    expect(estimateNarrativeCostMicrousd(0,0)).toBe(0);
  });

  it("samples routine scenes deterministically",()=>{
    const key="player:scene:2026-07-23";
    expect(shouldSampleRoutineScene(key)).toBe(shouldSampleRoutineScene(key));
  });

  it("does not claim a platform provider without complete credentials",()=>{
    expect(configuredPlatformAvailable()).toBe(false);
  });
});
