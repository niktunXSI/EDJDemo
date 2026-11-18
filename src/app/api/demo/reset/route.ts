import { z } from "zod";
import { config } from "@/lib/server/config";
import { withTransaction } from "@/lib/server/db";
import { ApiError, json, readJson, route } from "@/lib/server/http";
import { resetDemoData } from "@/lib/server/seed";
import { requireUiSession } from "@/lib/server/session";

const schema = z.object({ confirm: z.literal("RESET", "Type RESET to confirm.") });

export const POST = route(async (request: Request) => {
  await requireUiSession(request);
  if (!config.demoMode) {
    throw new ApiError(403, "demo_mode_disabled", "Demo reset is disabled because DEMO_MODE is not enabled for this environment.");
  }
  schema.parse(await readJson(request));
  await withTransaction((tx) => resetDemoData(tx));
  return json({ reset: true });
});
