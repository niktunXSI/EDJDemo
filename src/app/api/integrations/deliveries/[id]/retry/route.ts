import { json, route } from "@/lib/server/http";
import { requireUiSession } from "@/lib/server/session";
import { retryDelivery } from "@/lib/server/webhooks/dispatcher";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireUiSession(request);
  const { id } = await params;
  const result = await retryDelivery(id, actor);
  return json({
    id,
    status: result?.status ?? "pending",
    attempt: result?.attemptNumber ?? null,
    statusCode: result?.statusCode ?? null,
    error: result?.error ?? null,
  });
});
