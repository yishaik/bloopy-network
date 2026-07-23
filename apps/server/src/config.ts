import { z } from "zod";

const booleanFromString = z.enum(["true", "false"]).transform((value) => value === "true");

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
  PROACTIVE_DELAY_SECONDS: z.coerce.number().int().positive().default(7200)
});

export type Config = z.infer<typeof schema>;
export const config = schema.parse(process.env);
