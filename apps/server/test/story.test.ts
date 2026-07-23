import { describe, expect, it } from "vitest";
import { buildStory, parseBotConversation } from "../src/story.js";

const personality={archetype:"curious_trickster",voice:"warm_deadpan",curiosity:0.8,courage:0.5,empathy:0.6,mischief:0.8,sociability:0.7};

describe("story engine",()=>{
  it("returns a complete deterministic story card",()=>{const story=buildStory("explore","Bloop",personality,42);expect(story.title).toContain("Expedition");expect(story.choices.length).toBeGreaterThan(0);expect(story.reward?.xp).toBeGreaterThan(0);});
  it("parses bounded bot-to-bot conversation envelopes",()=>{expect(parseBotConversation("/bloopy_story abcdefgh123 2")).toEqual({interactionId:"abcdefgh123",depth:2});expect(parseBotConversation("/bloopy_story bad 9")).toBeNull();});
});
