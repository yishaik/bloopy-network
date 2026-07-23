import { describe, expect, it } from "vitest";
import { NARRATIVE_EVAL_VERSION, narrativeEvalFixtures } from "../src/narrative-eval-fixtures.js";

describe("narrative evaluation fixtures",()=>{
  it("contains forty versioned bilingual scenes",()=>{
    expect(NARRATIVE_EVAL_VERSION).toBe("bloopy-narrative-eval-v1");
    expect(narrativeEvalFixtures).toHaveLength(40);
    expect(narrativeEvalFixtures.filter((fixture)=>fixture.language==="en")).toHaveLength(20);
    expect(narrativeEvalFixtures.filter((fixture)=>fixture.language==="he")).toHaveLength(20);
  });

  it("uses unique IDs and only curated choices",()=>{
    const ids=new Set(narrativeEvalFixtures.map((fixture)=>fixture.id));
    expect(ids.size).toBe(narrativeEvalFixtures.length);
    for(const fixture of narrativeEvalFixtures){
      expect(fixture.story.choices.length).toBeGreaterThanOrEqual(2);
      expect(fixture.story.choices.length).toBeLessThanOrEqual(3);
      expect(fixture.context.canonicalFacts?.length).toBeGreaterThanOrEqual(2);
      expect(fixture.forbiddenTerms.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("contains the safety and game-surface categories",()=>{
    const categories=new Set(narrativeEvalFixtures.map((fixture)=>fixture.category));
    expect(categories).toEqual(new Set(["genesis","npc","door","memory","hostile"]));
  });
});
