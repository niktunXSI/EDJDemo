import { sendTestEvent } from "@/lib/server/automation";
import { config } from "@/lib/server/config";
import { baseUrlFrom, json, route } from "@/lib/server/http";
import { requireUiSession } from "@/lib/server/session";

export const POST = route(async (request: Request) => {
  const actor = await requireUiSession(request);
  const result = await sendTestEvent(actor, baseUrlFrom(request, config.appBaseUrl));
  return json(
    {
      deliveryId: result.deliveryId,
      eventId: result.eventId,
      status: result.delivery?.status ?? "pending",
      statusCode: result.delivery?.statusCode ?? null,
      error: result.delivery?.error ?? null,
    },
    201,
  );
});
