import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateTelegramInitData } from "../src/auth.js";

const BOT_TOKEN = "1234567:test-bot-token";

function signInitData(params: Record<string, string>, botToken = BOT_TOKEN): string {
  const dataCheckString = Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const usp = new URLSearchParams(params);
  usp.set("hash", hash);
  return usp.toString();
}

const baseParams = () => ({
  auth_date: String(Math.floor(Date.now() / 1000)),
  query_id: "AAF3Yz0aAAAAAHdjPRpS7oa-",
  user: JSON.stringify({ id: 99, first_name: "Piko", username: "piko" })
});

describe("validateTelegramInitData", () => {
  it("accepts a correctly signed payload and returns the user", () => {
    const user = validateTelegramInitData(signInitData(baseParams()), BOT_TOKEN);
    expect(user.id).toBe(99);
    expect(user.first_name).toBe("Piko");
  });

  it("uses code-point key ordering, including keys where locale ordering differs", () => {
    const params = { ...baseParams(), a_key: "1", aKey: "2", "a-key": "3" };
    expect(() => validateTelegramInitData(signInitData(params), BOT_TOKEN)).not.toThrow();
  });

  it("rejects expired payloads", () => {
    const params = { ...baseParams(), auth_date: String(Math.floor(Date.now() / 1000) - 7200) };
    expect(() => validateTelegramInitData(signInitData(params), BOT_TOKEN)).toThrow();
  });

  it("rejects tampered payloads", () => {
    const signed = signInitData(baseParams());
    const tampered = new URLSearchParams(signed);
    tampered.set("user", JSON.stringify({ id: 31337, first_name: "Mallory" }));
    expect(() => validateTelegramInitData(tampered.toString(), BOT_TOKEN)).toThrow();
  });

  it("rejects payloads signed by a different bot", () => {
    const signed = signInitData(baseParams(), "another:token");
    expect(() => validateTelegramInitData(signed, BOT_TOKEN)).toThrow();
  });

  it("rejects payloads with a missing hash", () => {
    const usp = new URLSearchParams(baseParams());
    expect(() => validateTelegramInitData(usp.toString(), BOT_TOKEN)).toThrow();
  });
});
