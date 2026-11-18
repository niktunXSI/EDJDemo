import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-cpi-signature";
export const TIMESTAMP_HEADER = "x-cpi-timestamp";
export const EVENT_ID_HEADER = "x-cpi-event-id";
export const EVENT_TYPE_HEADER = "x-cpi-event-type";
export const ATTEMPT_HEADER = "x-cpi-delivery-attempt";
export const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Signature = hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`)), sent as `X-CPI-Signature: v1=<hex>`.
 * The timestamp (Unix seconds) is sent in `X-CPI-Timestamp`.
 */
export function computeSignature(secret: string, timestamp: number | string, rawBody: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

export function signatureHeaders(secret: string, rawBody: string, now: Date = new Date()) {
  const timestamp = Math.floor(now.getTime() / 1000);
  return {
    [TIMESTAMP_HEADER]: String(timestamp),
    [SIGNATURE_HEADER]: `v1=${computeSignature(secret, timestamp, rawBody)}`,
  };
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function verifySignature(options: {
  secret: string;
  rawBody: string;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  toleranceSeconds?: number;
  now?: Date;
}): VerifyResult {
  const { secret, rawBody, timestamp, signature } = options;
  if (!timestamp || !signature) return { ok: false, reason: "Missing signature or timestamp header." };
  if (!/^\d+$/.test(timestamp)) return { ok: false, reason: "Malformed timestamp header." };
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - Number(timestamp)) > tolerance) {
    return { ok: false, reason: "Timestamp is outside the allowed tolerance window." };
  }
  const expected = Buffer.from(computeSignature(secret, timestamp, rawBody), "hex");
  // Multiple signatures may be sent comma-separated during secret rotation.
  const candidates = signature
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));
  for (const candidate of candidates) {
    if (!/^[a-f0-9]{64}$/i.test(candidate)) continue;
    const provided = Buffer.from(candidate, "hex");
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) return { ok: true };
  }
  return { ok: false, reason: "Signature does not match." };
}
