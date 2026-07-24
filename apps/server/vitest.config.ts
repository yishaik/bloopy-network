import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgres://bloopy:bloopy@localhost:5432/bloopy_test",
      APP_ENCRYPTION_KEY: "kA1goEmBvq3gpitJo1PKC4uM85wWqYWpDsaRV+tlKsk=",
      TELEGRAM_WEBHOOK_SECRET: "vitest-webhook-secret-value",
      ALLOW_LOCAL_AI: "false"
    }
  }
});
