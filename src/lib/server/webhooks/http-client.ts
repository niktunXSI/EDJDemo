import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isPrivateAddress } from "./destination";

export class DeliveryTimeoutError extends Error {
  name = "TimeoutError";
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * Resolves the hostname and rejects private addresses at connection time, so the address that
 * was checked is the address that is used (no DNS-rebinding window between check and connect).
 */
function guardedLookup(allowPrivate: boolean) {
  return (hostname: string, options: { all?: boolean; family?: number }, callback: LookupCallback) => {
    dnsLookup(hostname, { family: options.family ?? 0, all: true }, (error, addresses) => {
      if (error) return callback(error, []);
      const list = addresses as LookupAddress[];
      if (list.length === 0) return callback(new Error(`No addresses found for ${hostname}`), []);
      if (!allowPrivate && list.some((entry) => isPrivateAddress(entry.address))) {
        return callback(new Error("Webhook destination resolves to a private network address."), []);
      }
      if (options.all) callback(null, list);
      else callback(null, list[0].address, list[0].family);
    });
  };
}

export interface WebhookResponse {
  status: number;
  /** For 4xx/5xx JSON responses only: the receiver's short `message`/`error` text, unredacted. */
  reason: string | null;
  /** Set when an intermediary (proxy or CDN) appears to have produced the response. */
  via: string | null;
}

function extractReason(contentType: string, raw: string): string | null {
  if (!contentType.includes("json") || !raw) return null;
  try {
    const data = JSON.parse(raw);
    const candidate =
      (typeof data?.message === "string" && data.message) ||
      (typeof data?.error === "string" && data.error) ||
      (typeof data?.error?.message === "string" && data.error.message) ||
      null;
    return candidate ? String(candidate).slice(0, 200) : null;
  } catch {
    return null;
  }
}

/**
 * POSTs a body and returns the status code. Redirects are not followed. The response body is
 * drained and discarded; for error responses only a short JSON reason field is kept so failed
 * deliveries can be diagnosed. Arbitrary receiver content is never stored or shown.
 */
export function postWebhook(
  target: string,
  headers: Record<string, string>,
  body: string,
  options: { timeoutMs: number; allowPrivate: boolean },
): Promise<WebhookResponse> {
  const url = new URL(target);
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(
      url,
      {
        method: "POST",
        headers: { ...headers, "content-length": String(Buffer.byteLength(body)) },
        lookup: guardedLookup(options.allowPrivate) as never,
        timeout: options.timeoutMs,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const keep = status >= 400;
        const chunks: Buffer[] = [];
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (keep && received <= 16 * 1024) chunks.push(chunk);
          if (received > 64 * 1024) response.destroy();
        });
        const finish = () => {
          const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
          const viaHeader = response.headers["via"] ?? response.headers["x-squid-error"] ?? null;
          resolve({
            status,
            reason: keep ? extractReason(contentType, Buffer.concat(chunks).toString("utf8")) : null,
            via: keep && viaHeader ? String(viaHeader).slice(0, 80) : null,
          });
        };
        response.on("end", finish);
        response.on("close", finish);
        response.on("error", finish);
      },
    );
    const timer = setTimeout(() => request.destroy(new DeliveryTimeoutError("timeout")), options.timeoutMs);
    request.on("timeout", () => request.destroy(new DeliveryTimeoutError("timeout")));
    request.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.on("close", () => clearTimeout(timer));
    request.end(body);
  });
}
