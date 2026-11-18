import "server-only";
import { releaseExpiredLeases } from "./automation";
import { config } from "./config";
import { redact } from "./redact";
import { dispatchDue } from "./webhooks/dispatcher";

/** One durable worker pass: return expired leases to the queue, then send due webhook deliveries. */
export async function runWorkerTick() {
  const leasesReleased = await releaseExpiredLeases();
  const deliveries = await dispatchDue();
  return { leasesReleased, ...deliveries };
}

const state = globalThis as unknown as { __cpiWorker?: { timer: NodeJS.Timeout; running: boolean } };

/** Starts the in-process worker loop (long-running Node servers only). */
export function startInlineWorker() {
  if (!config.inlineWorker || state.__cpiWorker) return;
  const worker = { running: false, timer: undefined as unknown as NodeJS.Timeout };
  worker.timer = setInterval(async () => {
    if (worker.running) return;
    worker.running = true;
    try {
      await runWorkerTick();
    } catch (error) {
      console.error("[worker] tick failed:", redact(error));
    } finally {
      worker.running = false;
    }
  }, config.workerIntervalMs);
  worker.timer.unref?.();
  state.__cpiWorker = worker;
  console.log(`[worker] inline delivery worker started (every ${config.workerIntervalMs} ms)`);
}
