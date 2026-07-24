import { describe,expect,it } from "vitest";
import { formatBotInteractionEnvelope,parseBotInteractionEnvelope,signBotInteractionTurn } from "../src/telegram-control.js";

describe("managed bot interaction envelopes",()=>{
  const interactionId="123e4567-e89b-12d3-a456-426614174000";
  it("round-trips a signed turn",()=>{
    const text=formatBotInteractionEnvelope(interactionId,2,101,202);
    const parsed=parseBotInteractionEnvelope(text);
    expect(parsed).toEqual({interactionId,turn:2,signature:signBotInteractionTurn(interactionId,2,101,202)});
  });
  it("binds the signature to sender, receiver and turn",()=>{
    expect(signBotInteractionTurn(interactionId,0,101,202)).not.toBe(signBotInteractionTurn(interactionId,1,101,202));
    expect(signBotInteractionTurn(interactionId,0,101,202)).not.toBe(signBotInteractionTurn(interactionId,0,202,101));
  });
  it("rejects copied legacy and malformed envelopes",()=>{
    expect(parseBotInteractionEnvelope(`/bloopy_story ${interactionId} 0`)).toBeNull();
    expect(parseBotInteractionEnvelope(`/bloopy_story ${interactionId} 99 ${"a".repeat(43)}`)).toBeNull();
    expect(parseBotInteractionEnvelope("hello")).toBeNull();
  });
});
