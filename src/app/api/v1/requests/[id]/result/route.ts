import { requireAgent } from "@/lib/server/agent-auth";
import { recordResult } from "@/lib/server/automation";
import { json, readJson, route } from "@/lib/server/http";
import { resultSchema } from "@/lib/validation";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireAgent(request);
  const { id } = await params;
  const input = resultSchema.parse(await readJson(request));
  const result = await recordResult(id, input);
  return json({ data: result });
});
