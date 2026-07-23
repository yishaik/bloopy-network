import { z } from "zod";

const booleanFromString = z.enum(["true", "false"]).transform((value) => value === "true");
const csv = z.string().default("").transform((value)=>value.split(",").map((entry)=>entry.trim()).filter(Boolean));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  TELEGRAM_MANAGER_BOT_TOKEN: z.string().optional(),
  TELEGRAM_MANAGER_BOT_USERNAME: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(8).default("dev-webhook-secret"),
  APP_ENCRYPTION_KEY: z.string().default("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
  DEMO_MODE: booleanFromString.default("false"),
  ALLOW_LOCAL_AI: booleanFromString.default("false"),
  CHARACTER_GENESIS_ENABLED: booleanFromString.default("true"),
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
  PROACTIVE_DELAY_SECONDS: z.coerce.number().int().positive().default(7200)
});

export type Config = z.infer<typeof schema>;
export const config = schema.parse(process.env);
