import { describe, expect, it } from "vitest";
import { mergeNarrativeOutput } from "../src/ai.js";
import type { StoryCard } from "../src/types.js";

const story:StoryCard={title:"A fixed event",body:"Numa found a key under the nest.",choices:[{id:"open",label:"Open it",action:"explore"},{id:"ask",label:"Ask Numa",action:"talk"}],reward:{xp:8,stars:2}};

describe("constrained narrative output",()=>{
  it("changes expression while preserving canonical game fields",()=>{
    const result=mergeNarrativeOutput(story,{title:"Numa has a key-shaped problem",body:"Numa holds up the key and waits for your very professional opinion."});
    expect(result?.choices).toEqual(story.choices);
    expect(result?.reward).toEqual(story.reward);
    expect(result?.title).not.toBe(story.title);
  });

  it("rejects extra keys, links, HTML and oversized output",()=>{
    expect(mergeNarrativeOutput(story,{title:"Valid title",body:"Valid body",choices:[]})).toBeNull();
    expect(mergeNarrativeOutput(story,{title:"Valid title",body:"Visit https://example.com"})).toBeNull();
    expect(mergeNarrativeOutput(story,{title:"<b>Title</b>",body:"Valid body"})).toBeNull();
    expect(mergeNarrativeOutput(story,{title:"Valid title",body:"x".repeat(651)})).toBeNull();
  });
});
