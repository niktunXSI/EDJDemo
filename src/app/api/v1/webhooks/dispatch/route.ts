import { requireAgent } from "@/lib/server/agent-auth";
import { json, route } from "@/lib/server/http";
import { runWorkerTick } from "@/lib/server/worker";

/** Worker/cron entry point: processes due webhook deliveries and expired leases. */
export const POST = route(async (request: Request) => {
  await requireAgent(request);
  return json({ data: await runWorkerTick() });
});
