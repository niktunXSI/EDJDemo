import { requireAgent } from "@/lib/server/agent-auth";
import { detailView } from "@/lib/server/agent-views";
import { config } from "@/lib/server/config";
import { baseUrlFrom, json, route } from "@/lib/server/http";
import { requireRequest } from "@/lib/server/requests";
import { getSettings } from "@/lib/server/settings";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireAgent(request);
  const { id } = await params;
  const detail = await requireRequest(id);
  const settings = await getSettings();
  return json({ data: await detailView(detail, baseUrlFrom(request, config.appBaseUrl), settings.includeClientIdentity) });
});
