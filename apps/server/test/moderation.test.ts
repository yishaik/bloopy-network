import { describe, expect, it } from "vitest";
import { isBlockedName, isBlockedText } from "../src/moderation.js";

describe("moderation", () => {
  it("blocks profanity in narration, including leet variants", () => {
    expect(isBlockedText("what the fuck is this door")).toBe(true);
    expect(isBlockedText("sh1t happens in the nest")).toBe(true);
    expect(isBlockedText("a completely wholesome expedition")).toBe(false);
  });

  it("does not block innocent words containing risky substrings", () => {
    expect(isBlockedText("the grape sushi arrived by peacock")).toBe(false);
    expect(isBlockedText("Cassandra assembled the class passport")).toBe(false);
  });

  it("blocks bad and impersonating names, including spaced evasion", () => {
    expect(isBlockedName("F u c k face")).toBe(true);
    expect(isBlockedName("Telegram Support")).toBe(true);
    expect(isBlockedName("Official Moderator")).toBe(true);
    expect(isBlockedName("b1tchy")).toBe(true);
  });

  it("allows normal creature names", () => {
    expect(isBlockedName("Piko Moon")).toBe(false);
    expect(isBlockedName("Sir Blooplington III")).toBe(false);
    expect(isBlockedName("פיקו")).toBe(false);
  });
});
