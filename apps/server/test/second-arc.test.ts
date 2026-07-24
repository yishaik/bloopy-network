import { describe, expect, it } from "vitest";
import { buildLetterBeat, LETTER_ARC_START_BEAT, resolveLetterChoice } from "../src/second-arc.js";
import type { DoorStoryState } from "../src/impossible-door.js";

function walk(choices: Array<[string, string]>, route: "numa"|"sock"|"secret"|null = "numa") {
  let state: DoorStoryState = {};
  let beat = LETTER_ARC_START_BEAT;
  let last;
  for (const [beatId, choiceId] of choices) {
    expect(beat).toBe(beatId);
    last = resolveLetterChoice(beatId, choiceId, route, state, "Piko");
    state = last.state;
    beat = last.nextBeat;
  }
  return { transition: last!, state, beat };
}

describe("the letter from tomorrow", () => {
  it("renders every beat with bounded canonical facts", () => {
    for (const beatId of ["envelope_arrives", "thirteenth_hour", "inside_hour", "the_sender", "last_post", "ending"]) {
      const beat = buildLetterBeat(beatId, "Piko", "sock", {});
      expect(beat.totalChapters).toBe(7);
      expect(beat.canonicalFacts.length).toBeGreaterThan(0);
      expect(beat.story.title.length).toBeGreaterThan(3);
    }
  });

  it("carries the door-route ally through the letter beats", () => {
    expect(buildLetterBeat("envelope_arrives", "Piko", "sock", {}).story.choices.map((c) => c.label).join()).toContain("Dr. Sock");
    expect(buildLetterBeat("envelope_arrives", "Piko", "secret", {}).story.choices.map((c) => c.label).join()).toContain("Momo");
  });

  it("completes the mail-a-warning path with flags and a cliffhanger", () => {
    const { transition } = walk([
      ["envelope_arrives", "open_now"],
      ["thirteenth_hour", "enter_hour"],
      ["inside_hour", "find_sender"],
      ["the_sender", "refuse_to_know"],
      ["last_post", "mail_warning"]
    ]);
    expect(transition.status).toBe("completed");
    expect(transition.nextBeat).toBe("ending");
    expect(transition.xp).toBe(20);
    expect(transition.flags.some((flag) => flag.key === "letter_from_tomorrow_completed")).toBe(true);
    expect(transition.cliffhanger?.title).toContain("blank envelope");
  });

  it("grants the thirteenth stamp only on the keep path", () => {
    const kept = walk([
      ["envelope_arrives", "hold_to_light"],
      ["thirteenth_hour", "bargain_hour"],
      ["inside_hour", "read_returns"],
      ["the_sender", "ask_what_happens"],
      ["last_post", "keep_stamp"]
    ]);
    expect(kept.transition.inventory).toEqual([{ itemId: "thirteenth_stamp", delta: 1, reason: "kept_the_stamp" }]);
    const mailed = walk([
      ["envelope_arrives", "show_ally"],
      ["thirteenth_hour", "chart_hour"],
      ["inside_hour", "find_sender"],
      ["the_sender", "ask_what_happens"],
      ["last_post", "mail_snack"]
    ], "secret");
    expect(mailed.transition.inventory).toHaveLength(0);
    expect(mailed.transition.relationships.some((rel) => rel.targetSlug === "momo-marketbot")).toBe(true);
  });

  it("rejects unauthored choices and finished beats", () => {
    expect(() => resolveLetterChoice("envelope_arrives", "eat_the_letter", "numa", {}, "Piko")).toThrow("arc_invalid_choice");
    expect(() => resolveLetterChoice("ending", "open_now", "numa", {}, "Piko")).toThrow();
  });

  it("varies the ending by the final choice", () => {
    const warn = buildLetterBeat("ending", "Piko", null, { letterFinal: "mail_warning" } as unknown as DoorStoryState);
    const stamp = buildLetterBeat("ending", "Piko", null, { letterFinal: "keep_stamp" } as unknown as DoorStoryState);
    expect(warn.story.body).not.toBe(stamp.story.body);
    expect(warn.aiEligible).toBe(false);
  });
});
