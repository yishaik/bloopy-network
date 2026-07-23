import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import type { TelegramUser } from "./types.js";

export function validateTelegramInitData(initData: string, botToken: string): TelegramUser {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("missing Telegram hash");
  params.delete("hash");

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > 3600) throw new Error("expired Telegram init data");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const received = Buffer.from(hash, "hex");
  const expected = Buffer.from(computed, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error("invalid Telegram signature");

  const rawUser = params.get("user");
  if (!rawUser) throw new Error("missing Telegram user");
  return JSON.parse(rawUser) as TelegramUser;
}

export function resolveRequestUser(initData?: string): TelegramUser {
  if (initData && config.TELEGRAM_MANAGER_BOT_TOKEN) return validateTelegramInitData(initData, config.TELEGRAM_MANAGER_BOT_TOKEN);
  if (config.DEMO_MODE) return { id: 424242, first_name: "Demo", username: "bloopy_demo", language_code: "en" };
  throw new Error("Telegram authentication is required");
}
