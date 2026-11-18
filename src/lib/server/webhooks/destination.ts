import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ApiError } from "../http";

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata", "metadata.google.internal", "instance-data"]);
const BLOCKED_SUFFIXES = [".localhost", ".internal", ".local", ".localdomain"];

function ipv4Private(address: string) {
  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return ipv4Private(address);
  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return ipv4Private(mapped[1]);
    return lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb") || lower.startsWith("ff");
  }
  return false;
}

export function privateDestinationsAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS === "true";
}

/**
 * Guards outbound webhook requests against server-side request forgery. In production, the
 * destination must resolve only to public addresses. Local development may target localhost.
 */
export async function assertSafeDestination(raw: string, options: { allowPrivate?: boolean } = {}) {
  const allowPrivate = options.allowPrivate ?? privateDestinationsAllowed();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(422, "invalid_webhook_url", "Enter a valid webhook URL.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "169.254.169.254" || host === "100.100.100.200" || host === "metadata.google.internal") {
    throw new ApiError(422, "invalid_webhook_url", "That host is not allowed as a webhook destination.");
  }
  if (allowPrivate) return;
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new ApiError(422, "invalid_webhook_url", "Webhook destinations must be public internet hosts.");
  }
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
    } catch {
      throw new ApiError(422, "invalid_webhook_url", `The webhook host ${host} could not be resolved.`);
    }
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new ApiError(422, "invalid_webhook_url", "Webhook destinations must resolve to public IP addresses.");
  }
}
