import { requireAgent } from "@/lib/server/agent-auth";
import { updateAutomationStatus } from "@/lib/server/automation";
import { json, readJson, route } from "@/lib/server/http";
import { automationStatusSchema } from "@/lib/validation";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireAgent(request);
  const { id } = await params;
  const input = automationStatusSchema.parse(await readJson(request));
  return json({ data: await updateAutomationStatus(id, input) });
});
