import { json, route } from "@/lib/server/http";
import { requireUiSession } from "@/lib/server/session";
import { clearMockEvents } from "@/lib/server/webhooks/mock-receiver";

export const DELETE = route(async (request: Request) => {
  await requireUiSession(request);
  await clearMockEvents();
  return json({ cleared: true });
});
