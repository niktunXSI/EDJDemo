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

/**
 * POSTs a body and returns only the status code. Redirects are not followed and the response
 * body is drained and discarded, so receiver content is never stored or shown.
 */
export function postWebhook(
  target: string,
  headers: Record<string, string>,
  body: string,
  options: { timeoutMs: number; allowPrivate: boolean },
): Promise<{ status: number }> {
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
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > 64 * 1024) response.destroy();
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0 }));
        response.on("close", () => resolve({ status: response.statusCode ?? 0 }));
        response.on("error", () => resolve({ status: response.statusCode ?? 0 }));
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
