import { describe, expect, it } from "vitest";
import { buildStory, parseBotConversation } from "../src/story.js";

const personality={archetype:"curious_trickster",voice:"warm_deadpan",curiosity:0.8,courage:0.5,empathy:0.6,mischief:0.8,sociability:0.7};

describe("story engine",()=>{
  it("returns a complete deterministic story card",()=>{const story=buildStory("explore","Bloop",personality,42);expect(story.title).toContain("Expedition");expect(story.choices.length).toBeGreaterThan(0);expect(story.reward?.xp).toBeGreaterThan(0);});
  it("parses bounded bot-to-bot conversation envelopes",()=>{expect(parseBotConversation("/bloopy_story abcdefgh123 2")).toEqual({interactionId:"abcdefgh123",depth:2});expect(parseBotConversation("/bloopy_story bad 9")).toBeNull();});
});

describe("story engine additions",()=>{
  it("parses double-digit depths and rejects out-of-range depths",()=>{
    expect(parseBotConversation("/bloopy_story abcdefgh123 10")).toEqual({interactionId:"abcdefgh123",depth:10});
    expect(parseBotConversation("/bloopy_story abcdefgh123 13")).toBeNull();
  });
  it("varies the social story by partner",()=>{
    expect(buildStory("social","Bloop",personality,1,"Momo").title).toContain("Momo");
    expect(buildStory("social","Bloop",personality,1,"Dr. Sock").title).toContain("Dr. Sock");
    expect(buildStory("social","Bloop",personality,1).title).toContain("Numa");
  });
});
