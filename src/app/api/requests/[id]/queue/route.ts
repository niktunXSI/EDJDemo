import { queueRequest } from "@/lib/server/automation";
import { config } from "@/lib/server/config";
import { baseUrlFrom, json, readJson, route } from "@/lib/server/http";
import { requireUiSession } from "@/lib/server/session";
import { queueSchema } from "@/lib/validation";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireUiSession(request);
  const { id } = await params;
  const { force } = queueSchema.parse(await readJson(request));
  const outcome = await queueRequest(id, actor, { baseUrl: baseUrlFrom(request, config.appBaseUrl), force, reason: "manual" });
  return json(
    {
      created: outcome.created,
      job: outcome.job,
      webhookEnabled: outcome.webhookEnabled,
      delivery: outcome.delivery
        ? {
            id: outcome.delivery.id,
            status: outcome.delivery.status,
            attempt: outcome.delivery.attemptNumber,
            statusCode: outcome.delivery.statusCode,
            error: outcome.delivery.error,
          }
        : outcome.deliveryId
          ? { id: outcome.deliveryId, status: "pending" }
          : null,
    },
    outcome.created ? 201 : 200,
  );
});
