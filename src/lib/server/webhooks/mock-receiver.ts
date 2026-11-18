import "server-only";
import { sql } from "../db";
import { redact } from "../redact";
import { getSettings } from "../settings";
import { EVENT_ID_HEADER, EVENT_TYPE_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "./signing";

export const MOCK_TARGET = "mock://client-product-insights/mock-receiver";
const KEPT_HEADERS = [EVENT_ID_HEADER, EVENT_TYPE_HEADER, TIMESTAMP_HEADER, "x-cpi-delivery-attempt", "content-type", "user-agent"];
const MAX_STORED = 200;

export interface MockReceipt {
  status: number;
  body: { received: boolean; signatureValid: boolean; error?: string; mock: true };
}

/**
 * The built-in mock receiver. It verifies the signature exactly as an external
 * receiver should, stores the event for display, and responds like a webhook endpoint.
 */
export async function receiveMockWebhook(
  rawBody: string,
  headers: Headers,
  options: { recordInvalid?: boolean } = {},
): Promise<MockReceipt> {
  const settings = await getSettings();
  const verdict = verifySignature({
    secret: settings.secret,
    rawBody,
    timestamp: headers.get(TIMESTAMP_HEADER),
    signature: headers.get(SIGNATURE_HEADER),
  });
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = null;
  }
  const status = !verdict.ok ? 401 : settings.mockFailureMode ? 503 : 202;
  const kept: Record<string, string> = {};
  for (const name of KEPT_HEADERS) {
    const value = headers.get(name);
    if (value) kept[name] = value;
  }
  if (headers.get(SIGNATURE_HEADER)) kept[SIGNATURE_HEADER] = "v1=[REDACTED]";
  const data = (body?.data ?? {}) as Record<string, unknown>;
  if (!verdict.ok && options.recordInvalid === false) {
    return { status, body: { received: false, signatureValid: false, error: redact(verdict.reason), mock: true } };
  }
  await sql(
    `insert into mock_receiver_events (event_id, event_type, request_id, signature_valid, signature_error, response_status, headers, body)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      (body?.id as string) ?? headers.get(EVENT_ID_HEADER),
      (body?.type as string) ?? headers.get(EVENT_TYPE_HEADER),
      (data.requestId as string) ?? null,
      verdict.ok,
      verdict.ok ? null : verdict.reason,
      status,
      JSON.stringify(kept),
      body ? JSON.stringify(body) : null,
    ],
  );
  await sql(
    `delete from mock_receiver_events where id not in (select id from mock_receiver_events order by received_at desc limit ${MAX_STORED})`,
  );
  if (!verdict.ok) {
    return { status, body: { received: false, signatureValid: false, error: redact(verdict.reason), mock: true } };
  }
  if (status === 503) {
    return { status, body: { received: false, signatureValid: true, error: "Mock receiver is in simulated failure mode.", mock: true } };
  }
  return { status, body: { received: true, signatureValid: true, mock: true } };
}

export interface MockEvent {
  id: number;
  receivedAt: string;
  eventId: string | null;
  eventType: string | null;
  requestId: string | null;
  signatureValid: boolean;
  signatureError: string | null;
  responseStatus: number;
  headers: Record<string, string>;
  body: unknown;
}

export async function listMockEvents(limit = 25): Promise<MockEvent[]> {
  const rows = await sql<Record<string, unknown>>(
    `select * from mock_receiver_events order by received_at desc, id desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    receivedAt: new Date(r.received_at as string).toISOString(),
    eventId: (r.event_id as string) ?? null,
    eventType: (r.event_type as string) ?? null,
    requestId: (r.request_id as string) ?? null,
    signatureValid: Boolean(r.signature_valid),
    signatureError: (r.signature_error as string) ?? null,
    responseStatus: Number(r.response_status),
    headers: (r.headers as Record<string, string>) ?? {},
    body: r.body ?? null,
  }));
}

export async function clearMockEvents() {
  await sql("delete from mock_receiver_events");
}
