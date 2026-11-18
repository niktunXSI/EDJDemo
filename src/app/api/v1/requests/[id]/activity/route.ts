import { requireAgent } from "@/lib/server/agent-auth";
import { json, route } from "@/lib/server/http";
import { getActivity, requireRequest } from "@/lib/server/requests";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireAgent(request);
  const { id } = await params;
  const detail = await requireRequest(id);
  const events = await getActivity(detail.id);
  return json({
    data: events.map((e) => ({
      id: e.id,
      type: e.eventType,
      summary: e.summary,
      actor: { type: e.actorType, name: e.actorName },
      details: e.details,
      isSample: e.isSample,
      occurredAt: e.createdAt,
    })),
    requestId: detail.id,
    revision: detail.revision,
  });
});
