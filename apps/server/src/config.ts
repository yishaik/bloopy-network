import { z } from "zod";

const booleanFromString = z.enum(["true", "false"]).transform((value) => value === "true");
const csv = z.string().default("").transform((value)=>value.split(",").map((entry)=>entry.trim()).filter(Boolean));

// base64 of 32 zero bytes — the old shipped default; a public key must never encrypt real secrets
const INSECURE_ENCRYPTION_KEYS = new Set(["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="]);
const PLACEHOLDER_SECRETS = new Set(["dev-webhook-secret", "replace-with-random-secret", "GENERATE_ME"]);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  TELEGRAM_MANAGER_BOT_TOKEN: z.string().optional(),
  TELEGRAM_MANAGER_BOT_USERNAME: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).default("dev-webhook-secret"),
  APP_ENCRYPTION_KEY: z.string().min(1, "APP_ENCRYPTION_KEY is required; generate one with: openssl rand -base64 32"),
  ADMIN_API_KEY: z.string().min(32, "ADMIN_API_KEY must be at least 32 characters").optional(),
  DEMO_MODE: booleanFromString.default("false"),
  ALLOW_LOCAL_AI: booleanFromString.default("false"),
  CHARACTER_GENESIS_ENABLED: booleanFromString.default("true"),
  IMPOSSIBLE_DOOR_ENABLED: booleanFromString.default("true"),
  DOOR_CLIFFHANGER_DELAY_SECONDS: z.coerce.number().int().positive().default(3600),
  PLATFORM_AI_ENABLED: booleanFromString.default("true"),
  PLATFORM_AI_BASE_URL: z.string().url().optional(),
  PLATFORM_AI_MODEL: z.string().min(1).max(160).optional(),
  PLATFORM_AI_API_KEY: z.string().min(1).optional(),
  PLATFORM_AI_ALLOWED_MODELS: csv,
  PLATFORM_AI_INPUT_USD_PER_MILLION: z.coerce.number().positive().optional(),
  PLATFORM_AI_OUTPUT_USD_PER_MILLION: z.coerce.number().positive().optional(),
  PLATFORM_AI_MONTHLY_BUDGET_USD: z.coerce.number().min(0).max(10000).default(10),
  AI_PLATFORM_DAILY_REQUEST_LIMIT: z.coerce.number().int().min(0).max(1000).default(20),
  AI_BYOK_DAILY_REQUEST_LIMIT: z.coerce.number().int().min(0).max(5000).default(100),
  AI_PLATFORM_ENRICHMENT_PERCENT: z.coerce.number().int().min(0).max(100).default(30),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(15000).default(4500),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(60).max(400).default(160),
  PROACTIVE_DELAY_SECONDS: z.coerce.number().int().positive().default(7200),
  TELEGRAM_INGRESS_ENABLED: booleanFromString.default("true"),
  MANAGED_BOT_FLEET_ENABLED: booleanFromString.default("true"),
  BOT_TO_BOT_ENABLED: booleanFromString.default("true"),
  OUTBOX_ENABLED: booleanFromString.default("true"),
  DEGRADED_MODE: booleanFromString.default("false"),
  BOT_INTERACTION_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  BOT_INTERACTION_MAX_TURNS: z.coerce.number().int().min(2).max(8).default(4),
  BOT_INTERACTION_PAIR_HOURLY_LIMIT: z.coerce.number().int().min(1).max(100).default(5),
  BOT_INTERACTION_OWNER_DAILY_LIMIT: z.coerce.number().int().min(1).max(500).default(20),
  PROCESSED_UPDATE_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  TELEGRAM_UPDATE_LEASE_SECONDS: z.coerce.number().int().min(15).max(300).default(60),
  OUTBOX_LEASE_SECONDS: z.coerce.number().int().min(15).max(300).default(45),
  TELEGRAM_UPDATE_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  TELEGRAM_UPDATE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(7),
  READY_MAX_UPDATE_BACKLOG: z.coerce.number().int().min(1).max(100000).default(500),
  READY_MAX_OUTBOX_BACKLOG: z.coerce.number().int().min(1).max(100000).default(500)
}).superRefine((value, ctx) => {
  if (INSECURE_ENCRYPTION_KEYS.has(value.APP_ENCRYPTION_KEY)) ctx.addIssue({ code: "custom", path: ["APP_ENCRYPTION_KEY"], message: "APP_ENCRYPTION_KEY is the public all-zero development key; generate a real one with: openssl rand -base64 32" });
  if (value.NODE_ENV === "production") {
    if (value.DEMO_MODE) ctx.addIssue({ code: "custom", path: ["DEMO_MODE"], message: "DEMO_MODE must be false in production" });
    if (PLACEHOLDER_SECRETS.has(value.TELEGRAM_WEBHOOK_SECRET)) ctx.addIssue({ code: "custom", path: ["TELEGRAM_WEBHOOK_SECRET"], message: "TELEGRAM_WEBHOOK_SECRET is a placeholder; generate one with: openssl rand -base64 24" });
  }
});

export type Config = z.infer<typeof schema>;
export const config = schema.parse(process.env);
