import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sql, withTransaction } from "@/lib/server/db";
import { resetDemoData } from "@/lib/server/seed";
import { CSRF_COOKIE, CSRF_HEADER, PERSONA_COOKIE, SESSION_COOKIE } from "@/lib/session-constants";

export const USER = { type: "user" as const, id: "TM-01", name: "Jordan Ellis" };

export async function resetDatabase() {
  await withTransaction((tx) => resetDemoData(tx));
  await sql(
    `update webhook_config set enabled = true, destination = 'mock', url = null, auto_queue = false,
       include_client_identity = false, mock_failure_mode = false where id = 1`,
  );
}

export async function makeDueNow() {
  await sql("update webhook_deliveries set next_attempt_at = now() - interval '1 second' where status = 'pending'");
}

const CSRF = "test-csrf-token-0123456789";

export function uiRequest(path: string, init: { method?: string; body?: unknown; csrf?: string | null } = {}) {
  const headers: Record<string, string> = {
    cookie: `${SESSION_COOKIE}=demo_test; ${CSRF_COOKIE}=${CSRF}; ${PERSONA_COOKIE}=TM-01`,
    host: "localhost:4317",
    origin: "http://localhost:4317",
  };
  if (init.csrf !== null) headers[CSRF_HEADER] = init.csrf ?? CSRF;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://localhost:4317${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export function agentRequest(path: string, apiKey: string | null, init: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { host: "localhost:4317" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://localhost:4317${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export const params = (id: string) => ({ params: Promise.resolve({ id }) });

export interface Received {
  headers: IncomingMessage["headers"];
  body: string;
}

/** A local HTTP receiver whose response status can be scripted per request. */
export async function startReceiver(statuses: number[] | ((n: number) => number)) {
  const received: Received[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      const n = received.length;
      const status = typeof statuses === "function" ? statuses(n) : (statuses[n - 1] ?? statuses[statuses.length - 1]);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: status < 300 }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/hooks/cpi`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
