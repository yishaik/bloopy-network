import { describe, expect, it } from "vitest";
import { applyWakeChoice, identityStory, normalizeCreatureName, proactiveGenesisText, wakeFlag } from "../src/onboarding.js";
import type { Personality } from "../src/types.js";

const personality:Personality={archetype:"gentle_explorer",voice:"earnest_whimsy",curiosity:0.5,courage:0.5,empathy:0.5,mischief:0.5,sociability:0.5};

describe("character genesis rules",()=>{
  it("applies bounded personality changes",()=>{
    expect(applyWakeChoice(personality,"gentle")).toMatchObject({empathy:0.6,courage:0.48});
    expect(applyWakeChoice(personality,"noise")).toMatchObject({courage:0.59,mischief:0.58});
    expect(applyWakeChoice(personality,"snack")).toMatchObject({sociability:0.59,curiosity:0.56});
  });

  it("normalizes valid names and rejects unsafe names",()=>{
    expect(normalizeCreatureName("  Piko   Moon ")).toBe("Piko Moon");
    expect(normalizeCreatureName("פיקו")).toBe("פיקו");
    expect(()=>normalizeCreatureName("<script>")).toThrow();
    expect(()=>normalizeCreatureName("a")).toThrow();
  });

  it("keeps story consequences authored and bounded",()=>{
    const story=identityStory("Piko","snack","moon");
    expect(story.title).toContain("Piko");
    expect(story.choices).toHaveLength(2);
    expect(story.choices.map((choice)=>choice.action)).toEqual(["explore","talk"]);
    expect(wakeFlag("snack")).toBe("genesis_woken_snack");
    expect(proactiveGenesisText("Piko","snack")).toContain("key");
  });
});
