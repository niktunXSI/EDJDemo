import { json, readJson, route } from "@/lib/server/http";
import { requireUiSession } from "@/lib/server/session";
import { toPublicSettings, updateSettings } from "@/lib/server/settings";
import { settingsSchema } from "@/lib/validation";

export const PATCH = route(async (request: Request) => {
  const actor = await requireUiSession(request);
  const patch = settingsSchema.parse(await readJson(request));
  return json(toPublicSettings(await updateSettings(patch, actor.name)));
});
