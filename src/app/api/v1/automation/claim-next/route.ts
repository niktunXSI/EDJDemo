import { requireAgent } from "@/lib/server/agent-auth";
import { claimNext } from "@/lib/server/automation";
import { json, readJson, route } from "@/lib/server/http";
import { claimSchema } from "@/lib/validation";

export const POST = route(async (request: Request) => {
  await requireAgent(request);
  const input = claimSchema.parse(await readJson(request));
  const claim = await claimNext(input.workerId, input.leaseSeconds);
  if (!claim) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  return json({ data: claim });
});
