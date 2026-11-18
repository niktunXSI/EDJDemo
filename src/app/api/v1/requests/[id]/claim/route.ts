import { requireAgent } from "@/lib/server/agent-auth";
import { claimRequest } from "@/lib/server/automation";
import { json, readJson, route } from "@/lib/server/http";
import { claimSchema } from "@/lib/validation";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireAgent(request);
  const { id } = await params;
  const input = claimSchema.parse(await readJson(request));
  const claim = await claimRequest(id, input.workerId, input.leaseSeconds);
  return json({ data: claim });
});
