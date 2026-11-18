import "server-only";

function flag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function int(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export const config = {
  get demoMode() {
    return flag("DEMO_MODE", true);
  },
  get seedOnEmpty() {
    return flag("SEED_ON_EMPTY", true);
  },
  get appBaseUrl() {
    return process.env.APP_BASE_URL?.trim().replace(/\/+$/, "") || "";
  },
  /** Comma-separated keys accepted by the Agent API, in addition to the stored demo key. */
  get envApiKeys(): string[] {
    return (process.env.AGENT_API_KEYS ?? process.env.AGENT_API_KEY ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
  },
  get envWebhookUrl() {
    return process.env.WEBHOOK_URL?.trim() || "";
  },
  get envWebhookSecret() {
    return process.env.WEBHOOK_SIGNING_SECRET?.trim() || "";
  },
  get webhookTimeoutMs() {
    return int("WEBHOOK_TIMEOUT_MS", 8000);
  },
  get webhookMaxAttempts() {
    return int("WEBHOOK_MAX_ATTEMPTS", 5);
  },
  /** Base delay for exponential retry backoff. */
  get webhookRetryBaseMs() {
    return int("WEBHOOK_RETRY_BASE_MS", 15000);
  },
  get inlineWorker() {
    return flag("DELIVERY_WORKER_INLINE", true);
  },
  get workerIntervalMs() {
    return int("DELIVERY_WORKER_INTERVAL_MS", 5000);
  },
  get defaultLeaseSeconds() {
    return int("AUTOMATION_LEASE_SECONDS", 300);
  },
};
