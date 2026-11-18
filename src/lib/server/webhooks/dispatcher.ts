import "server-only";
import { randomUUID } from "node:crypto";
import type { DeliveryStatus } from "@/lib/domain";
import { config } from "../config";
import { sql, type Queryable } from "../db";
import { ApiError, conflict, notFound } from "../http";
import { redact, sanitizeUrl } from "../redact";
import { recordActivity, type ActorRef } from "../requests";
import { getSettings, type IntegrationSettings } from "../settings";
import { assertSafeDestination, privateDestinationsAllowed } from "./destination";
import { DeliveryTimeoutError, postWebhook } from "./http-client";
import { MOCK_TARGET, receiveMockWebhook } from "./mock-receiver";
import { ATTEMPT_HEADER, EVENT_ID_HEADER, EVENT_TYPE_HEADER, signatureHeaders } from "./signing";

const SYSTEM: ActorRef = { type: "system", id: null, name: "Webhook dispatcher" };
const USER_AGENT = "EdwardJones-ClientProductInsights-Webhooks/1.0";
const MAX_BACKOFF_MS = 30 * 60 * 1000;

export interface DeliveryRow {
  id: string;
  event_id: string;
  event_type: string;
  request_id: string | null;
  job_id: string | null;
  payload: string;
  destination: "mock" | "external";
  target_url: string | null;
  status: DeliveryStatus;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: Date;
  locked_until: Date | null;
  last_attempt_at: Date | null;
  delivered_at: Date | null;
  last_status_code: number | null;
  last_error: string | null;
  is_test: boolean;
  is_sample: boolean;
  created_at: Date;
  updated_at: Date;
}

export function newDeliveryId() {
  return `dlv_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/** Writes an outbox row. Call inside the same transaction that records the queued state. */
export async function enqueueDelivery(
  q: Queryable,
  options: {
    eventId: string;
    eventType: string;
    requestId: string | null;
    jobId: string | null;
    payload: unknown;
    settings: IntegrationSettings;
    isTest?: boolean;
  },
) {
  const id = newDeliveryId();
  const destination = options.settings.destination;
  await q.query(
    `insert into webhook_deliveries (id, event_id, event_type, request_id, job_id, payload, destination, target_url, max_attempts, is_test)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      options.eventId,
      options.eventType,
      options.requestId,
      options.jobId,
      JSON.stringify(options.payload),
      destination,
      destination === "external" ? options.settings.url : MOCK_TARGET,
      config.webhookMaxAttempts,
      options.isTest ?? false,
    ],
  );
  return id;
}

export function backoffMs(attemptNumber: number, random = Math.random()) {
  const base = config.webhookRetryBaseMs * 2 ** Math.max(0, attemptNumber - 1);
  const jitter = 0.8 + random * 0.4;
  return Math.min(Math.round(base * jitter), MAX_BACKOFF_MS);
}

async function claimDue(limit: number, onlyId?: string): Promise<DeliveryRow[]> {
  const params: unknown[] = [limit];
  let filter = "";
  if (onlyId) {
    params.push(onlyId);
    filter = "and id = $2";
  }
  return sql<DeliveryRow>(
    `update webhook_deliveries set status = 'sending', locked_until = now() + interval '90 seconds', updated_at = now()
     where id in (
       select id from webhook_deliveries
       where ((status = 'pending' and next_attempt_at <= now()) or (status = 'sending' and locked_until < now())) ${filter}
       order by next_attempt_at asc
       limit $1
       for update skip locked)
     returning *`,
    params,
  );
}

type Outcome = "success" | "http_error" | "timeout" | "network_error" | "signature_rejected";

interface AttemptResult {
  outcome: Outcome;
  statusCode: number | null;
  error: string | null;
  responseExcerpt: string | null;
  retryable: boolean;
  durationMs: number;
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function send(row: DeliveryRow, settings: IntegrationSettings, attemptNumber: number): Promise<AttemptResult> {
  const rawBody = row.payload;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": USER_AGENT,
    [EVENT_ID_HEADER]: row.event_id,
    [EVENT_TYPE_HEADER]: row.event_type,
    [ATTEMPT_HEADER]: String(attemptNumber),
    ...signatureHeaders(settings.secret, rawBody),
  };
  const started = Date.now();

  if (row.destination === "mock") {
    const receipt = await receiveMockWebhook(rawBody, new Headers(headers));
    const ok = receipt.status >= 200 && receipt.status < 300;
    return {
      outcome: ok ? "success" : receipt.status === 401 ? "signature_rejected" : "http_error",
      statusCode: receipt.status,
      error: ok ? null : `Mock receiver responded ${receipt.status}: ${receipt.body.error ?? "error"}`,
      responseExcerpt: JSON.stringify(receipt.body),
      retryable: !ok && isRetryableStatus(receipt.status),
      durationMs: Date.now() - started,
    };
  }

  const target = row.target_url;
  if (!target) {
    return { outcome: "network_error", statusCode: null, error: "No webhook URL is configured.", responseExcerpt: null, retryable: false, durationMs: 0 };
  }
  try {
    await assertSafeDestination(target);
  } catch (error) {
    return {
      outcome: "network_error",
      statusCode: null,
      error: error instanceof Error ? error.message : "Destination not allowed.",
      responseExcerpt: null,
      retryable: false,
      durationMs: Date.now() - started,
    };
  }
  if (settings.bearerToken) headers.authorization = `Bearer ${settings.bearerToken}`;
  try {
    const response = await postWebhook(target, headers, rawBody, {
      timeoutMs: config.webhookTimeoutMs,
      allowPrivate: privateDestinationsAllowed(),
    });
    const ok = response.status >= 200 && response.status < 300;
    return {
      outcome: ok ? "success" : "http_error",
      statusCode: response.status,
      error: ok
        ? null
        : redact(
            `Receiver responded with HTTP ${response.status}${response.status >= 300 && response.status < 400 ? " (redirects are not followed)" : ""}${response.reason ? `: ${response.reason}` : "."}${response.via ? ` (answered by intermediary: ${response.via})` : ""}`,
            300,
          ),
      responseExcerpt: null,
      retryable: !ok && isRetryableStatus(response.status),
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const timedOut = error instanceof DeliveryTimeoutError;
    const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : "";
    return {
      outcome: timedOut ? "timeout" : "network_error",
      statusCode: null,
      error: timedOut
        ? `No response within ${config.webhookTimeoutMs} ms.`
        : redact(`${error instanceof Error ? error.message : String(error)}${cause}`, 300),
      responseExcerpt: null,
      retryable: true,
      durationMs: Date.now() - started,
    };
  }
}

function destinationLabel(row: DeliveryRow) {
  if (row.destination === "mock") return "the built-in mock receiver (simulated; not sent externally)";
  try {
    return new URL(row.target_url ?? "").host;
  } catch {
    return "the configured endpoint";
  }
}

async function attempt(row: DeliveryRow, settings: IntegrationSettings) {
  const attemptNumber = row.attempt_count + 1;
  const result = await send(row, settings, attemptNumber);
  const exhausted = attemptNumber >= row.max_attempts;
  let status: DeliveryStatus;
  let nextAttemptAt: Date | null = null;
  if (result.outcome === "success") status = "delivered";
  else if (result.retryable && !exhausted) {
    status = "pending";
    nextAttemptAt = new Date(Date.now() + backoffMs(attemptNumber));
  } else status = "failed";

  await sql(
    `insert into webhook_attempts (delivery_id, attempt_number, duration_ms, status_code, outcome, error, response_excerpt, target)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      row.id,
      attemptNumber,
      result.durationMs,
      result.statusCode,
      result.outcome,
      result.error,
      result.responseExcerpt,
      row.destination === "mock" ? MOCK_TARGET : sanitizeUrl(row.target_url),
    ],
  );
  await sql(
    `update webhook_deliveries set status = $2, attempt_count = $3, last_attempt_at = now(), last_status_code = $4,
       last_error = $5, locked_until = null, next_attempt_at = coalesce($6, next_attempt_at),
       delivered_at = case when $2 = 'delivered' then now() else delivered_at end, updated_at = now()
     where id = $1`,
    [row.id, status, attemptNumber, result.statusCode, result.error, nextAttemptAt],
  );

  if (row.request_id && !row.is_test) {
    const where = destinationLabel(row);
    if (status === "delivered") {
      await recordActivity({ query: sql }, row.request_id, SYSTEM, "webhook.delivered",
        `Webhook delivered to ${where} on attempt ${attemptNumber}. Awaiting automation pickup.`,
        { deliveryId: row.id, eventId: row.event_id, statusCode: result.statusCode, mock: row.destination === "mock" });
    } else if (status === "pending") {
      await recordActivity({ query: sql }, row.request_id, SYSTEM, "webhook.attempt_failed",
        `Webhook attempt ${attemptNumber} of ${row.max_attempts} failed; retry scheduled.`,
        { deliveryId: row.id, eventId: row.event_id, error: result.error, nextAttemptAt: nextAttemptAt?.toISOString() });
    } else {
      await recordActivity({ query: sql }, row.request_id, SYSTEM, "webhook.failed",
        `Webhook delivery failed after ${attemptNumber} attempt${attemptNumber === 1 ? "" : "s"}. The request remains queued and discoverable through the Agent API.`,
        { deliveryId: row.id, eventId: row.event_id, error: result.error });
    }
  }
  return { id: row.id, status, attemptNumber, ...result };
}

/** Sends one specific delivery now if it is due (used right after queueing and for manual retry). */
export async function deliverNow(id: string) {
  const settings = await getSettings();
  if (!settings.enabled) return null;
  const [row] = await claimDue(1, id);
  if (!row) return null;
  return attempt(row, settings);
}

/** Processes due deliveries. Safe to call concurrently from many processes (rows are claimed with SKIP LOCKED). */
export async function dispatchDue(limit = 20) {
  const settings = await getSettings();
  if (!settings.enabled) return { processed: 0, delivered: 0, failed: 0, rescheduled: 0, paused: true };
  const rows = await claimDue(limit);
  let delivered = 0;
  let failed = 0;
  let rescheduled = 0;
  for (const row of rows) {
    const result = await attempt(row, settings);
    if (result.status === "delivered") delivered++;
    else if (result.status === "failed") failed++;
    else rescheduled++;
  }
  return { processed: rows.length, delivered, failed, rescheduled, paused: false };
}

export async function retryDelivery(id: string, actor: ActorRef) {
  const [row] = await sql<DeliveryRow>("select * from webhook_deliveries where id = $1", [id]);
  if (!row) throw notFound(`Delivery ${id}`);
  if (row.status === "delivered") throw conflict("already_delivered", "This delivery already succeeded.");
  if (row.status === "sending") throw conflict("in_flight", "This delivery is being sent right now.");
  const settings = await getSettings();
  if (!settings.enabled) throw new ApiError(409, "integration_disabled", "Enable the webhook connection before retrying.");
  await sql(
    `update webhook_deliveries set status = 'pending', next_attempt_at = now(),
       max_attempts = greatest(max_attempts, attempt_count + $2), updated_at = now()
     where id = $1 and status in ('failed', 'pending')`,
    [id, config.webhookMaxAttempts],
  );
  if (row.request_id && !row.is_test) {
    await recordActivity({ query: sql }, row.request_id, actor, "webhook.retry_requested",
      `Manual webhook retry requested (event ${row.event_id})`, { deliveryId: id, eventId: row.event_id });
  }
  return deliverNow(id);
}

export interface DeliveryView {
  id: string;
  eventId: string;
  eventType: string;
  requestId: string | null;
  destination: "mock" | "external";
  target: string | null;
  status: DeliveryStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  isTest: boolean;
  createdAt: string;
  payload?: unknown;
  attempts?: {
    attemptNumber: number;
    startedAt: string;
    durationMs: number;
    statusCode: number | null;
    outcome: string;
    error: string | null;
    responseExcerpt: string | null;
  }[];
}

const isoOrNull = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

function toView(row: DeliveryRow): DeliveryView {
  return {
    id: row.id,
    eventId: row.event_id,
    eventType: row.event_type,
    requestId: row.request_id,
    destination: row.destination,
    target: row.destination === "mock" ? "Built-in mock receiver" : sanitizeUrl(row.target_url),
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.status === "pending" ? isoOrNull(row.next_attempt_at) : null,
    lastAttemptAt: isoOrNull(row.last_attempt_at),
    deliveredAt: isoOrNull(row.delivered_at),
    lastStatusCode: row.last_status_code,
    lastError: row.last_error ? redact(row.last_error) : null,
    isTest: row.is_test,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function listDeliveries(options: { limit?: number; requestId?: string } = {}) {
  const params: unknown[] = [options.limit ?? 25];
  let where = "";
  if (options.requestId) {
    params.push(options.requestId);
    where = "where request_id = $2";
  }
  const rows = await sql<DeliveryRow>(`select * from webhook_deliveries ${where} order by created_at desc limit $1`, params);
  return rows.map(toView);
}

export async function getDelivery(id: string): Promise<DeliveryView | null> {
  const [row] = await sql<DeliveryRow>("select * from webhook_deliveries where id = $1", [id]);
  if (!row) return null;
  const attempts = await sql<Record<string, unknown>>(
    "select * from webhook_attempts where delivery_id = $1 order by attempt_number asc",
    [id],
  );
  let payload: unknown = null;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    payload = row.payload;
  }
  return {
    ...toView(row),
    payload,
    attempts: attempts.map((a) => ({
      attemptNumber: Number(a.attempt_number),
      startedAt: new Date(a.started_at as string).toISOString(),
      durationMs: Number(a.duration_ms),
      statusCode: (a.status_code as number) ?? null,
      outcome: a.outcome as string,
      error: a.error ? redact(a.error) : null,
      responseExcerpt: (a.response_excerpt as string) ?? null,
    })),
  };
}

export async function deliveryStats() {
  const [row] = await sql<{ pending: number; failed: number; delivered: number; mock_delivered: number; total: number }>(
    `select count(*) filter (where status in ('pending','sending'))::int as pending,
            count(*) filter (where status = 'failed')::int as failed,
            count(*) filter (where status = 'delivered' and destination = 'external')::int as delivered,
            count(*) filter (where status = 'delivered' and destination = 'mock')::int as mock_delivered,
            count(*)::int as total
     from webhook_deliveries`,
  );
  return row;
}
