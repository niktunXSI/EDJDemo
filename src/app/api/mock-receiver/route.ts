import { json, route } from "@/lib/server/http";
import { receiveMockWebhook } from "@/lib/server/webhooks/mock-receiver";

const MAX_BODY_BYTES = 256 * 1024;

/**
 * HTTP endpoint for the built-in mock receiver. Point the webhook URL here (for example
 * http://localhost:4317/api/mock-receiver) to exercise a real HTTP round trip locally.
 */
export const POST = route(async (request: Request) => {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    return json({ error: { code: "payload_too_large", message: "Payload exceeds 256 KB." } }, 413);
  }
  const receipt = await receiveMockWebhook(raw, request.headers);
  return json(receipt.body, receipt.status);
});
