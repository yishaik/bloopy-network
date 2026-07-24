import { describe, expect, it } from "vitest";
import { hashOAuthState, modelForMode, OPENROUTER_MODELS, pkceChallenge } from "../src/openrouter.js";

describe("OpenRouter PKCE",()=>{
  it("matches the RFC 7636 S256 example",()=>{
    const verifier="dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(pkceChallenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("hashes state deterministically without storing the raw value",()=>{
    const state="7hH7L19R2W4eBIB8QfSC6SRAxDUD2nPfyR6qJwwcJko";
    const hash=hashOAuthState(state);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(state);
    expect(hashOAuthState(state)).toBe(hash);
  });
});

describe("curated OpenRouter catalog",()=>{
  it("contains exactly three player-facing modes",()=>{
    expect(OPENROUTER_MODELS.map((entry)=>entry.mode)).toEqual(["balanced","creative","smart"]);
    expect(new Set(OPENROUTER_MODELS.map((entry)=>entry.model)).size).toBe(3);
  });

  it("maps only an allowed mode to an exact model ID",()=>{
    expect(modelForMode("balanced").model).toBe("qwen/qwen3.5-9b");
    expect(modelForMode("creative").model).toBe("google/gemini-3.1-flash-lite");
    expect(modelForMode("smart").model).toBe("openai/gpt-5.2");
    expect(()=>modelForMode("anything" as never)).toThrow("openrouter_mode_invalid");
  });
});
