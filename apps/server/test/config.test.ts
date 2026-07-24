import { describe, expect, it } from "vitest";
import { configSchema } from "../src/config.js";

const SAFE_KEY = "kA1goEmBvq3gpitJo1PKC4uM85wWqYWpDsaRV+tlKsk=";

/** The smallest environment a production deployment can legitimately boot with. */
function productionEnv(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  const base: Record<string, string | undefined> = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://bloopy:bloopy@db.internal:5432/bloopy",
    PUBLIC_BASE_URL: "https://bloopy.example",
    APP_ENCRYPTION_KEY: SAFE_KEY,
    TELEGRAM_WEBHOOK_SECRET: "a-real-webhook-secret-value",
    TELEGRAM_MANAGER_BOT_TOKEN: "123456:real-looking-manager-token",
    ADMIN_API_KEY: "an-admin-key-that-is-at-least-32-characters",
    DEMO_MODE: "false",
    ALLOW_LOCAL_AI: "false",
    ...overrides
  };
  return Object.fromEntries(Object.entries(base).filter(([, value]) => value !== undefined)) as Record<string, string>;
}

function issuePaths(env: Record<string, string>): string[] {
  const result = configSchema.safeParse(env);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("production launch guards", () => {
  it("accepts the documented Phase-1 production configuration", () => {
    const result = configSchema.safeParse(productionEnv({ TELEGRAM_INGRESS_ENABLED: "true", OUTBOX_ENABLED: "true", DEGRADED_MODE: "false", MANAGED_BOT_FLEET_ENABLED: "false", BOT_TO_BOT_ENABLED: "false" }));
    expect(result.success, JSON.stringify(result.success ? [] : result.error.issues)).toBe(true);
  });

  it("refuses a plain-http public base URL", () => {
    expect(issuePaths(productionEnv({ PUBLIC_BASE_URL: "http://bloopy.example" }))).toContain("PUBLIC_BASE_URL");
  });

  it("refuses demo mode and the loopback SSRF exemption", () => {
    expect(issuePaths(productionEnv({ DEMO_MODE: "true" }))).toContain("DEMO_MODE");
    expect(issuePaths(productionEnv({ ALLOW_LOCAL_AI: "true" }))).toContain("ALLOW_LOCAL_AI");
  });

  it("refuses to boot ingress without a manager bot token", () => {
    expect(issuePaths(productionEnv({ TELEGRAM_MANAGER_BOT_TOKEN: undefined }))).toContain("TELEGRAM_MANAGER_BOT_TOKEN");
    // Ingress explicitly off is a legitimate maintenance configuration.
    expect(issuePaths(productionEnv({ TELEGRAM_MANAGER_BOT_TOKEN: undefined, TELEGRAM_INGRESS_ENABLED: "false" }))).not.toContain("TELEGRAM_MANAGER_BOT_TOKEN");
  });

  it("requires the admin key that operational recovery depends on", () => {
    expect(issuePaths(productionEnv({ ADMIN_API_KEY: undefined }))).toContain("ADMIN_API_KEY");
    expect(issuePaths(productionEnv({ ADMIN_API_KEY: "too-short" }))).toContain("ADMIN_API_KEY");
  });

  it("refuses placeholder and publicly known secrets", () => {
    expect(issuePaths(productionEnv({ TELEGRAM_WEBHOOK_SECRET: "replace-with-random-secret" }))).toContain("TELEGRAM_WEBHOOK_SECRET");
    expect(issuePaths(productionEnv({ APP_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }))).toContain("APP_ENCRYPTION_KEY");
  });

  it("refuses bot-to-bot without the managed fleet, in every environment", () => {
    expect(issuePaths(productionEnv({ MANAGED_BOT_FLEET_ENABLED: "false", BOT_TO_BOT_ENABLED: "true" }))).toContain("BOT_TO_BOT_ENABLED");
    expect(issuePaths({ NODE_ENV: "development", DATABASE_URL: "postgres://localhost/bloopy", APP_ENCRYPTION_KEY: SAFE_KEY, MANAGED_BOT_FLEET_ENABLED: "false", BOT_TO_BOT_ENABLED: "true" })).toContain("BOT_TO_BOT_ENABLED");
  });

  it("requires the manager bot username once the fleet is enabled", () => {
    expect(issuePaths(productionEnv({ MANAGED_BOT_FLEET_ENABLED: "true" }))).toContain("TELEGRAM_MANAGER_BOT_USERNAME");
    expect(issuePaths(productionEnv({ MANAGED_BOT_FLEET_ENABLED: "true", TELEGRAM_MANAGER_BOT_USERNAME: "BloopyNetworkBot" }))).toEqual([]);
  });

  it("leaves development configurations alone", () => {
    const result = configSchema.safeParse({ NODE_ENV: "development", DATABASE_URL: "postgres://localhost/bloopy", APP_ENCRYPTION_KEY: SAFE_KEY, DEMO_MODE: "true", ALLOW_LOCAL_AI: "true", PUBLIC_BASE_URL: "http://localhost:3000" });
    expect(result.success, JSON.stringify(result.success ? [] : result.error.issues)).toBe(true);
  });
});
