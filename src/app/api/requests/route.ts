import { queueRequest } from "@/lib/server/automation";
import { config } from "@/lib/server/config";
import { baseUrlFrom, json, readJson, route } from "@/lib/server/http";
import { createRequest } from "@/lib/server/requests";
import { requireUiSession } from "@/lib/server/session";
import { getSettings } from "@/lib/server/settings";
import { createRequestSchema } from "@/lib/validation";

export const POST = route(async (request: Request) => {
  const actor = await requireUiSession(request);
  const input = createRequestSchema.parse(await readJson(request));
  const id = await createRequest(input, actor);
  const settings = await getSettings();
  let autoQueued = false;
  if (settings.autoQueue) {
    await queueRequest(id, actor, { baseUrl: baseUrlFrom(request, config.appBaseUrl), reason: "auto" });
    autoQueued = true;
  }
  return json({ id, autoQueued }, 201);
});
