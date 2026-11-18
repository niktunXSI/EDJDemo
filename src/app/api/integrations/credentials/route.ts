import { z } from "zod";
import { json, readJson, route } from "@/lib/server/http";
import { requireCredentialManager, requireUiSession } from "@/lib/server/session";
import { revealCredential, rotateCredential, toPublicSettings } from "@/lib/server/settings";

const schema = z.object({
  which: z.enum(["secret", "apiKey"]),
  action: z.enum(["reveal", "rotate"]),
});

export const POST = route(async (request: Request) => {
  const actor = await requireUiSession(request);
  requireCredentialManager(actor);
  const { which, action } = schema.parse(await readJson(request));
  if (action === "reveal") {
    return json({ value: await revealCredential(which) });
  }
  return json({ settings: toPublicSettings(await rotateCredential(which, actor.name)) });
});
