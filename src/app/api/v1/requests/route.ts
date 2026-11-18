import { requireAgent } from "@/lib/server/agent-auth";
import { listItemView } from "@/lib/server/agent-views";
import { releaseExpiredLeases } from "@/lib/server/automation";
import { config } from "@/lib/server/config";
import { baseUrlFrom, json, route } from "@/lib/server/http";
import { listRequests } from "@/lib/server/requests";
import { parseListQuery } from "@/lib/validation";

export const GET = route(async (request: Request) => {
  await requireAgent(request);
  const filters = parseListQuery(new URL(request.url).searchParams);
  if (filters.automationStatus?.length) await releaseExpiredLeases();
  const result = await listRequests(filters);
  const baseUrl = baseUrlFrom(request, config.appBaseUrl);
  return json({
    data: result.items.map((item) => listItemView(item, baseUrl)),
    pagination: { page: result.page, pageSize: result.pageSize, total: result.total, totalPages: result.totalPages },
  });
});
