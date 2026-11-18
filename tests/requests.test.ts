import { beforeEach, describe, expect, it } from "vitest";
import { POST as createRoute } from "@/app/api/requests/route";
import { PATCH as updateRoute } from "@/app/api/requests/[id]/route";
import { sql } from "@/lib/server/db";
import { createRequest, getActivity, listRequests, updateRequest } from "@/lib/server/requests";
import { createRequestSchema, listQuerySchema } from "@/lib/validation";
import { params, resetDatabase, uiRequest, USER } from "./support/helpers";

const valid = {
  title: "Show estimated settlement dates for pending transfers",
  requestType: "enhancement",
  clientId: "HH-3102",
  advisorId: "ADV-202",
  productArea: "transfers_payments",
  channel: "client_web",
  priority: "high",
  originalFeedback: "The client wants to know when transferred assets will be available to invest.",
  requestedOutcome: "Display an estimated settlement date on each pending transfer.",
  businessImpact: "Reduces status calls to branches during onboarding.",
  tags: ["Transfers", "transfers", "onboarding"],
};

describe("request creation and validation", () => {
  beforeEach(resetDatabase);

  it("seeds a realistic dataset", async () => {
    const [counts] = await sql<{ requests: number; clients: number; advisors: number }>(
      `select (select count(*)::int from requests) as requests, (select count(*)::int from clients) as clients,
              (select count(*)::int from advisors) as advisors`,
    );
    expect(counts.requests).toBeGreaterThanOrEqual(25);
    expect(counts.requests).toBeLessThanOrEqual(35);
    expect(counts.clients).toBeGreaterThanOrEqual(10);
    expect(counts.advisors).toBeGreaterThanOrEqual(6);
  });

  it("applies defaults and normalises tags", () => {
    const parsed = createRequestSchema.parse({ ...valid, priority: undefined });
    expect(parsed.priority).toBe("medium");
    expect(parsed.tags).toEqual(["transfers", "onboarding"]);
    expect(parsed.currentWorkaround).toBe("");
  });

  it("rejects missing fields, bad enums, and sensitive identifiers", () => {
    const result = createRequestSchema.safeParse({
      ...valid,
      title: "Short",
      productArea: "crypto",
      originalFeedback: "Client SSN is 123-45-6789 and wants faster transfers please.",
    });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["title", "productArea", "originalFeedback"]));
  });

  it("creates a request that is immediately listed with a submission event", async () => {
    const id = await createRequest(createRequestSchema.parse(valid), USER);
    expect(id).toMatch(/^CPI-\d{4}$/);
    const list = await listRequests(listQuerySchema.parse({ q: "settlement dates" }));
    expect(list.items.map((i) => i.id)).toContain(id);
    const created = list.items.find((i) => i.id === id)!;
    expect(created.status).toBe("new");
    expect(created.automationStatus).toBe("not_queued");
    const activity = await getActivity(id);
    expect(activity.map((e) => e.eventType)).toContain("request.submitted");
  });

  it("creates through the UI route with session and CSRF protection", async () => {
    const ok = await createRoute(uiRequest("/api/requests", { body: valid }));
    expect(ok.status).toBe(201);
    const body = await ok.json();
    expect(body.id).toMatch(/^CPI-/);
    expect(body.autoQueued).toBe(false);

    const noCsrf = await createRoute(uiRequest("/api/requests", { body: valid, csrf: null }));
    expect(noCsrf.status).toBe(403);
    expect((await noCsrf.json()).error.code).toBe("csrf_failed");

    const invalid = await createRoute(uiRequest("/api/requests", { body: { ...valid, title: "" } }));
    expect(invalid.status).toBe(422);
    const error = (await invalid.json()).error;
    expect(error.code).toBe("validation_failed");
    expect(error.details.fields[0].path).toBe("title");
  });

  it("accepts same-origin requests behind a proxy and rejects cross-site ones", async () => {
    const withHeaders = (extra: Record<string, string>, drop: string[] = []) => {
      const base = uiRequest("/api/requests", { body: valid });
      const headers = new Headers(base.headers);
      drop.forEach((h) => headers.delete(h));
      Object.entries(extra).forEach(([k, v]) => headers.set(k, v));
      return new Request(base.url, { method: "POST", headers, body: JSON.stringify(valid) });
    };
    const proxied = await createRoute(
      withHeaders({ host: "internal-runtime.example.net", origin: "https://client-product-insights.apps.example.com", "sec-fetch-site": "same-origin" }),
    );
    expect(proxied.status).toBe(201);
    const crossSite = await createRoute(withHeaders({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }));
    expect(crossSite.status).toBe(403);
    const legacyMismatch = await createRoute(withHeaders({ origin: "https://evil.example" }));
    expect(legacyMismatch.status).toBe(403);
    const forwarded = await createRoute(
      withHeaders({ host: "internal-runtime.example.net", "x-forwarded-host": "insights.example.com", origin: "https://insights.example.com" }),
    );
    expect(forwarded.status).toBe(201);
  });

  it("rejects references to unknown advisors", async () => {
    const res = await createRoute(uiRequest("/api/requests", { body: { ...valid, advisorId: "ADV-999" } }));
    expect(res.status).toBe(422);
  });

  it("records status, priority, and owner changes and rejects stale revisions", async () => {
    const id = await createRequest(createRequestSchema.parse(valid), USER);
    const first = await updateRequest(id, { status: "under_review", priority: "critical", ownerId: "TM-02", expectedRevision: 1 }, USER);
    expect(first.revision).toBe(2);
    const types = (await getActivity(id)).map((e) => e.eventType);
    expect(types).toEqual(expect.arrayContaining(["status.changed", "priority.changed", "request.assigned"]));

    const stale = await updateRoute(uiRequest(`/api/requests/${id}`, { method: "PATCH", body: { title: "A stale edit title", expectedRevision: 1 } }), params(id));
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("revision_conflict");
  });
});
