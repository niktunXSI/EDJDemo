import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { queueRequest } from "@/lib/server/automation";
import { sql } from "@/lib/server/db";
import { getSettings, updateSettings } from "@/lib/server/settings";
import { dispatchDue, getDelivery, retryDelivery } from "@/lib/server/webhooks/dispatcher";
import { computeSignature, signatureHeaders, verifySignature } from "@/lib/server/webhooks/signing";
import { listMockEvents } from "@/lib/server/webhooks/mock-receiver";
import { assertSafeDestination, isPrivateAddress } from "@/lib/server/webhooks/destination";
import { settingsSchema } from "@/lib/validation";
import { makeDueNow, resetDatabase, startReceiver, USER } from "./support/helpers";

const BASE = { baseUrl: "http://localhost:4317" };

describe("webhook signatures", () => {
  const secret = "whsec_test_secret_value_123456";
  const body = JSON.stringify({ id: "evt_1", type: "feedback.request.queued" });
  const now = new Date("2026-11-18T15:00:00Z");

  it("matches the documented HMAC-SHA256 format", () => {
    const headers = signatureHeaders(secret, body, now);
    expect(headers["x-cpi-timestamp"]).toBe(String(Math.floor(now.getTime() / 1000)));
    expect(headers["x-cpi-signature"]).toBe(`v1=${computeSignature(secret, headers["x-cpi-timestamp"], body)}`);
    expect(headers["x-cpi-signature"]).toMatch(/^v1=[a-f0-9]{64}$/);
  });

  it("verifies valid signatures and rejects tampering, wrong secrets, and replays", () => {
    const h = signatureHeaders(secret, body, now);
    const ok = verifySignature({ secret, rawBody: body, timestamp: h["x-cpi-timestamp"], signature: h["x-cpi-signature"], now });
    expect(ok.ok).toBe(true);
    expect(verifySignature({ secret, rawBody: `${body} `, timestamp: h["x-cpi-timestamp"], signature: h["x-cpi-signature"], now }).ok).toBe(false);
    expect(verifySignature({ secret: "whsec_other_secret_0000000", rawBody: body, timestamp: h["x-cpi-timestamp"], signature: h["x-cpi-signature"], now }).ok).toBe(false);
    const later = new Date(now.getTime() + 10 * 60 * 1000);
    const replay = verifySignature({ secret, rawBody: body, timestamp: h["x-cpi-timestamp"], signature: h["x-cpi-signature"], now: later });
    expect(replay).toEqual({ ok: false, reason: "Timestamp is outside the allowed tolerance window." });
    expect(verifySignature({ secret, rawBody: body, timestamp: null, signature: null, now }).ok).toBe(false);
  });

  it("accepts any matching signature during secret rotation", () => {
    const h = signatureHeaders(secret, body, now);
    const rotated = `v1=${"0".repeat(64)}, ${h["x-cpi-signature"]}`;
    expect(verifySignature({ secret, rawBody: body, timestamp: h["x-cpi-timestamp"], signature: rotated, now }).ok).toBe(true);
  });
});

describe("webhook delivery", () => {
  let receiver: Awaited<ReturnType<typeof startReceiver>> | null = null;
  beforeEach(resetDatabase);
  afterEach(async () => {
    await receiver?.close();
    receiver = null;
  });

  it("signs external deliveries and excludes client identity by default", async () => {
    receiver = await startReceiver([202]);
    await updateSettings({ destination: "external", url: receiver.url }, "test");
    const outcome = await queueRequest("CPI-1006", USER, BASE);
    expect(outcome.delivery?.status).toBe("delivered");
    expect(receiver.received).toHaveLength(1);
    const { headers, body } = receiver.received[0];
    const settings = await getSettings();
    const verdict = verifySignature({
      secret: settings.secret,
      rawBody: body,
      timestamp: headers["x-cpi-timestamp"] as string,
      signature: headers["x-cpi-signature"] as string,
    });
    expect(verdict.ok).toBe(true);
    const event = JSON.parse(body);
    expect(event).toMatchObject({ type: "feedback.request.queued", schemaVersion: "1.0", id: outcome.job.eventId });
    expect(headers["x-cpi-event-id"]).toBe(outcome.job.eventId);
    expect(event.data.requestId).toBe("CPI-1006");
    expect(event.data.revision).toBe(1);
    expect(event.correlationId).toMatch(/^cor_/);
    expect(event.data.links.apiUrl).toBe("http://localhost:4317/api/v1/requests/CPI-1006");
    expect(event.data.request.clientContext.segment).toBe("Preferred");
    expect(event.data.request.clientContext.householdName).toBeUndefined();
    expect(body).not.toContain("Chen-Albright");
    expect((await sql<{ automation_status: string }>("select automation_status from requests where id = 'CPI-1006'"))[0].automation_status).toBe("queued");
  });

  it("retries retryable failures with the same event id until delivered", async () => {
    receiver = await startReceiver([503, 500, 200]);
    await updateSettings({ destination: "external", url: receiver.url }, "test");
    const outcome = await queueRequest("CPI-1004", USER, BASE);
    expect(outcome.delivery?.status).toBe("pending");
    const id = outcome.deliveryId!;

    let delivery = await getDelivery(id);
    expect(delivery?.attemptCount).toBe(1);
    expect(delivery?.lastStatusCode).toBe(503);
    expect(new Date(delivery!.nextAttemptAt!).getTime()).toBeGreaterThan(Date.now());

    expect((await dispatchDue()).processed).toBe(0);
    await makeDueNow();
    await dispatchDue();
    await makeDueNow();
    await dispatchDue();

    delivery = await getDelivery(id);
    expect(delivery?.status).toBe("delivered");
    expect(delivery?.attempts?.map((a) => a.statusCode)).toEqual([503, 500, 200]);
    const eventIds = receiver.received.map((r) => r.headers["x-cpi-event-id"]);
    expect(new Set(eventIds)).toEqual(new Set([outcome.job.eventId]));
    expect(receiver.received.map((r) => r.headers["x-cpi-delivery-attempt"])).toEqual(["1", "2", "3"]);
  });

  it("marks exhausted deliveries failed and supports manual retry", async () => {
    let healthy = false;
    receiver = await startReceiver(() => (healthy ? 204 : 503));
    await updateSettings({ destination: "external", url: receiver.url }, "test");
    const outcome = await queueRequest("CPI-1004", USER, BASE);
    const id = outcome.deliveryId!;
    for (let i = 0; i < 3; i++) {
      await makeDueNow();
      await dispatchDue();
    }
    let delivery = await getDelivery(id);
    expect(delivery?.status).toBe("failed");
    expect(delivery?.attemptCount).toBe(3);
    expect(delivery?.lastError).toContain("503");

    healthy = true;
    const retried = await retryDelivery(id, USER);
    expect(retried?.status).toBe("delivered");
    delivery = await getDelivery(id);
    expect(delivery?.attemptCount).toBe(4);
    expect(new Set(receiver.received.map((r) => r.headers["x-cpi-event-id"])).size).toBe(1);
  });

  it("sends the destination bearer token and never stores the receiver's response body", async () => {
    receiver = await startReceiver([202]);
    await updateSettings({ destination: "external", url: receiver.url, bearerToken: "automation-trigger-token-123" }, "test");
    const outcome = await queueRequest("CPI-1004", USER, BASE);
    expect(outcome.delivery?.status).toBe("delivered");
    expect(receiver.received[0].headers.authorization).toBe("Bearer automation-trigger-token-123");
    const delivery = await getDelivery(outcome.deliveryId!);
    expect(delivery?.attempts?.[0].responseExcerpt).toBeNull();
    await updateSettings({ bearerToken: "" }, "test");
    expect((await getSettings()).bearerToken).toBe("");
  });

  it("records a short reason for refused deliveries without storing the body", async () => {
    const server = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: "error", message: "Automation is disabled", detail: "x".repeat(5000) }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    await updateSettings({ destination: "external", url: `http://127.0.0.1:${port}/hook` }, "test");
    const outcome = await queueRequest("CPI-1004", USER, BASE);
    const delivery = await getDelivery(outcome.deliveryId!);
    expect(delivery?.lastError).toBe("Receiver responded with HTTP 403: Automation is disabled");
    expect(delivery?.attempts?.[0].responseExcerpt).toBeNull();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("does not retry permanent client errors automatically", async () => {
    receiver = await startReceiver([400]);
    await updateSettings({ destination: "external", url: receiver.url }, "test");
    const outcome = await queueRequest("CPI-1004", USER, BASE);
    expect(outcome.delivery?.status).toBe("failed");
  });

  it("records unreachable endpoints as sanitized network errors", async () => {
    await updateSettings({ destination: "external", url: "http://127.0.0.1:9/unreachable?token=abc123secret" }, "test");
    const outcome = await queueRequest("CPI-1004", USER, BASE);
    const delivery = await getDelivery(outcome.deliveryId!);
    expect(delivery?.status).toBe("pending");
    expect(delivery?.attempts?.[0].outcome).toBe("network_error");
    expect(delivery?.target).not.toContain("abc123secret");
  });

  it("labels mock deliveries and verifies them in the mock receiver", async () => {
    const outcome = await queueRequest("CPI-1004", USER, BASE);
    const delivery = await getDelivery(outcome.deliveryId!);
    expect(delivery?.destination).toBe("mock");
    expect(delivery?.target).toBe("Built-in mock receiver");
    const [event] = await listMockEvents();
    expect(event.signatureValid).toBe(true);
    expect(event.eventId).toBe(outcome.job.eventId);
    expect(JSON.stringify(event.headers)).not.toMatch(/v1=[a-f0-9]{64}/);
  });

  it("simulated mock failures are retried, never shown as delivered", async () => {
    await updateSettings({ mockFailureMode: true }, "test");
    const outcome = await queueRequest("CPI-1004", USER, BASE);
    expect(outcome.delivery?.status).toBe("pending");
    expect(outcome.delivery?.statusCode).toBe(503);
  });
});

describe("webhook destination guard", () => {
  it("classifies private and public addresses", () => {
    for (const address of ["127.0.0.1", "10.2.3.4", "172.20.0.1", "192.168.1.10", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    for (const address of ["8.8.8.8", "52.1.2.3", "2606:4700::1111"]) expect(isPrivateAddress(address)).toBe(false);
  });

  it("rejects private destinations when private networks are not allowed", async () => {
    for (const url of ["https://localhost/hook", "https://10.0.0.5/hook", "https://service.internal/hook", "https://[::1]/hook"]) {
      await expect(assertSafeDestination(url, { allowPrivate: false })).rejects.toMatchObject({ code: "invalid_webhook_url" });
    }
    await expect(assertSafeDestination("https://8.8.8.8/hook", { allowPrivate: false })).resolves.toBeUndefined();
  });

  it("always rejects cloud metadata endpoints", async () => {
    await expect(assertSafeDestination("http://169.254.169.254/latest", { allowPrivate: true })).rejects.toMatchObject({ code: "invalid_webhook_url" });
  });
});

describe("integration settings validation", () => {
  it("accepts pasted tokens with a Bearer prefix, long tokens, and long URLs", () => {
    const long = "k".repeat(3000);
    const parsed = settingsSchema.parse({
      url: `https://api2.example.com/automations/webhook/${"a".repeat(600)}`,
      bearerToken: `  Bearer ${long}\n`,
    });
    expect(parsed.bearerToken).toBe(long);
    expect(settingsSchema.parse({ bearerToken: "" }).bearerToken).toBe("");
  });

  it("explains invalid tokens", () => {
    const result = settingsSchema.safeParse({ bearerToken: "two words here" });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toEqual(["bearerToken"]);
  });
});
