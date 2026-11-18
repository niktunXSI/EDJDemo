import { json, readJson, route } from "@/lib/server/http";
import { updateRequest } from "@/lib/server/requests";
import { requireUiSession } from "@/lib/server/session";
import { updateRequestSchema } from "@/lib/validation";

export const PATCH = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireUiSession(request);
  const { id } = await params;
  const input = updateRequestSchema.parse(await readJson(request));
  return json(await updateRequest(id, input, actor));
});
