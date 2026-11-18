import { route } from "@/lib/server/http";
import { listAllRequests, requestsToCsv } from "@/lib/server/requests";
import { requireUiSession } from "@/lib/server/session";
import { parseListQuery } from "@/lib/validation";

export const GET = route(async (request: Request) => {
  await requireUiSession(request);
  const filters = parseListQuery(new URL(request.url).searchParams);
  const items = await listAllRequests(filters);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(`\uFEFF${requestsToCsv(items)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="client-product-insights-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
