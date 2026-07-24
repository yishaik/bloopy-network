import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { open } from "./crypto.js";
import { db } from "./db.js";
import { authRequired, invalidSignature } from "./errors.js";
import type { TelegramUser } from "./types.js";

export function validateTelegramInitData(initData: string, botToken: string): TelegramUser {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw invalidSignature();
  params.delete("hash");

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > 3600) throw invalidSignature();

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const received = Buffer.from(hash, "hex");
  const expected = Buffer.from(computed, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw invalidSignature();

  const rawUser = params.get("user");
  if (!rawUser) throw invalidSignature();
  return JSON.parse(rawUser) as TelegramUser;
}

export function parseUnsafeStartParam(initData: string): string | null {
  const value = new URLSearchParams(initData).get("start_param");
  return value && /^[a-zA-Z0-9_-]{1,120}$/.test(value) ? value : null;
}

function parseUnsafeUserId(initData: string): number | null {
  try {
    const raw = new URLSearchParams(initData).get("user");
    if (!raw) return null;
    const id = (JSON.parse(raw) as { id?: unknown }).id;
    return typeof id === "number" && Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

// Mini App requests may be signed by the manager bot OR by one of the user's managed creature
// bots (Telegram signs initData with whichever bot hosted the web app), so try each candidate.
export async function resolveRequestUser(initData?: string): Promise<TelegramUser> {
  if (!initData) {
    if (config.DEMO_MODE && config.NODE_ENV !== "production") return { id: 424242, first_name: "Demo", username: "bloopy_demo", language_code: "en" };
    throw authRequired();
  }
  const candidates: string[] = [];
  if (config.TELEGRAM_MANAGER_BOT_TOKEN) candidates.push(config.TELEGRAM_MANAGER_BOT_TOKEN);
  const unsafeUserId = parseUnsafeUserId(initData);
  if (unsafeUserId !== null) {
    const owned = await db.query("SELECT token_cipher FROM managed_bots WHERE owner_telegram_user_id=$1 AND enabled=true ORDER BY updated_at DESC LIMIT 5", [unsafeUserId]);
    for (const row of owned.rows) {
      try { candidates.push(open(row.token_cipher)); } catch { /* skip tokens sealed with a rotated key */ }
    }
  }
  let lastError: unknown = null;
  for (const token of candidates) {
    try { return validateTelegramInitData(initData, token); } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error && lastError.name === "AppError" ? lastError : invalidSignature();
}
