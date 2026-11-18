// Standalone delivery worker. It calls the authenticated dispatch endpoint on an interval, so it
// works against any deployment (local PGlite or hosted Postgres) without opening the database itself.
//
//   APP_BASE_URL=http://localhost:4317 AGENT_API_KEY=cpi_demo_... npm run worker
//
// On serverless hosting, schedule the same POST from a cron job instead.

const baseUrl = (process.env.APP_BASE_URL || "http://localhost:4317").replace(/\/+$/, "");
const apiKey = process.env.AGENT_API_KEY || (process.env.AGENT_API_KEYS || "").split(",")[0]?.trim();
const intervalMs = Number(process.env.DELIVERY_WORKER_INTERVAL_MS || 5000);
const once = process.argv.includes("--once");

if (!apiKey) {
  console.error("Set AGENT_API_KEY (copy it from Integrations → Agent API access).");
  process.exit(1);
}

async function tick() {
  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl}/api/v1/webhooks/dispatch`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(60_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(`[worker] dispatch failed: HTTP ${response.status} ${body?.error?.message ?? ""}`);
      return;
    }
    const d = body.data;
    if (d.processed || d.leasesReleased) {
      console.log(
        `[worker] processed=${d.processed} delivered=${d.delivered} rescheduled=${d.rescheduled} failed=${d.failed} leasesReleased=${d.leasesReleased} (${Date.now() - started} ms)`,
      );
    }
  } catch (error) {
    console.error(`[worker] ${error instanceof Error ? error.message : error}`);
  }
}

console.log(`[worker] dispatching to ${baseUrl} every ${intervalMs} ms${once ? " (once)" : ""}`);
await tick();
if (!once) setInterval(tick, intervalMs);
