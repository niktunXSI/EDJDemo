import { requireAgent } from "@/lib/server/agent-auth";
import { attachExternalReference } from "@/lib/server/automation";
import { json, readJson, route } from "@/lib/server/http";
import { externalReferenceSchema } from "@/lib/validation";

export const PUT = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireAgent(request);
  const { id } = await params;
  const input = externalReferenceSchema.parse(await readJson(request));
  return json({ data: await attachExternalReference(id, input) });
});
