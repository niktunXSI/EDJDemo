import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/support/empty.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    testTimeout: 30000,
    hookTimeout: 60000,
    env: {
      PGLITE_DATA_DIR: "memory",
      DATABASE_URL: "",
      DEMO_MODE: "true",
      DELIVERY_WORKER_INLINE: "false",
      WEBHOOK_TIMEOUT_MS: "2000",
      WEBHOOK_RETRY_BASE_MS: "1000",
      WEBHOOK_MAX_ATTEMPTS: "3",
      AGENT_API_KEYS: "",
      AGENT_API_KEY: "",
      WEBHOOK_URL: "",
      WEBHOOK_SIGNING_SECRET: "",
    },
  },
});
