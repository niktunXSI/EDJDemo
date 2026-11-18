import { json, route } from "@/lib/server/http";
import { requireUiSession } from "@/lib/server/session";
import { runWorkerTick } from "@/lib/server/worker";

export const POST = route(async (request: Request) => {
  await requireUiSession(request);
  return json(await runWorkerTick());
});
