import { describe, expect, it } from "vitest";
import { open, seal } from "../src/crypto.js";

describe("credential crypto", () => {
  it("round-trips values through seal and open", () => {
    const secret = "sk-very-secret-provider-key-🔑";
    expect(open(seal(secret))).toBe(secret);
  });

  it("produces a fresh IV per seal", () => {
    expect(seal("same-input")).not.toBe(seal("same-input"));
  });

  it("rejects tampered ciphertext", () => {
    const sealed = seal("tamper-me");
    const [iv, tag, encrypted] = sealed.split(".") as [string, string, string];
    const flipped = encrypted[0] === "A" ? "B" : "A";
    expect(() => open([iv, tag, flipped + encrypted.slice(1)].join("."))).toThrow();
  });

  it("rejects tampered auth tags", () => {
    const sealed = seal("tamper-tag");
    const [iv, tag, encrypted] = sealed.split(".") as [string, string, string];
    const flipped = tag[0] === "A" ? "B" : "A";
    expect(() => open([iv, flipped + tag.slice(1), encrypted].join("."))).toThrow();
  });

  it("rejects malformed sealed values", () => {
    expect(() => open("not-a-sealed-value")).toThrow();
  });
});
