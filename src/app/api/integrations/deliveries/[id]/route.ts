import { json, notFound, route } from "@/lib/server/http";
import { requireUiSession } from "@/lib/server/session";
import { getDelivery } from "@/lib/server/webhooks/dispatcher";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireUiSession(request);
  const { id } = await params;
  const delivery = await getDelivery(id);
  if (!delivery) throw notFound(`Delivery ${id}`);
  return json(delivery);
});
