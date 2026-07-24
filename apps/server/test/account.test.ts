import { describe, expect, it } from "vitest";
import { assertConfirmation, EXPORT_SCHEMA_VERSION, subjectRef } from "../src/account.js";
import { AppError } from "../src/errors.js";

function rejection(action: "reset" | "delete", value: string): AppError | null {
  try { assertConfirmation(action, value); return null; } catch (error) { return error as AppError; }
}

describe("account lifecycle confirmations", () => {
  it("accepts only the exact phrase, ignoring surrounding whitespace", () => {
    expect(() => assertConfirmation("reset", "RESET")).not.toThrow();
    expect(() => assertConfirmation("reset", "  RESET\n")).not.toThrow();
    expect(() => assertConfirmation("delete", "DELETE")).not.toThrow();
  });

  it("rejects near misses, the wrong action's phrase and empty input", () => {
    for (const [action, value] of [["reset", "reset"], ["reset", "Reset"], ["reset", "DELETE"], ["delete", "delete"], ["delete", "DELETE ME"], ["delete", ""], ["delete", "RESET"]] as const) {
      const error = rejection(action, value);
      expect(error, `"${value}" was accepted for ${action}`).toBeInstanceOf(AppError);
      expect(error?.code).toBe("confirmation_mismatch");
      expect(error?.httpStatus).toBe(400);
    }
  });

  it("tells the player nothing changed when the confirmation is wrong", () => {
    expect(rejection("delete", "nope")?.userMessage).toContain("Nothing has been changed");
  });
});

describe("lifecycle audit references", () => {
  it("is stable for the same account and different across accounts", () => {
    expect(subjectRef(4242)).toBe(subjectRef(4242));
    expect(subjectRef("4242")).toBe(subjectRef(4242));
    expect(subjectRef(4242)).not.toBe(subjectRef(4243));
  });

  it("does not contain the identifier it references", () => {
    for (const id of [4242, 987654321, 1]) {
      expect(subjectRef(id)).not.toContain(String(id));
    }
    expect(subjectRef(null)).toHaveLength(32);
  });
});

describe("export contract", () => {
  it("declares a schema version so a future export can be told apart", () => {
    expect(EXPORT_SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
