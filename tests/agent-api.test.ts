import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as listRoute } from "@/app/api/v1/requests/route";
import { GET as getRoute } from "@/app/api/v1/requests/[id]/route";
import { GET as activityRoute } from "@/app/api/v1/requests/[id]/activity/route";
import { POST as claimRoute } from "@/app/api/v1/requests/[id]/claim/route";
import { POST as statusRoute } from "@/app/api/v1/requests/[id]/automation-status/route";
import { PUT as referenceRoute } from "@/app/api/v1/requests/[id]/external-reference/route";
import { POST as resultRoute } from "@/app/api/v1/requests/[id]/result/route";
import { POST as queueRoute } from "@/app/api/requests/[id]/queue/route";
import { getSettings } from "@/lib/server/settings";
import { agentRequest, params, resetDatabase, uiRequest } from "./support/helpers";

let apiKey = "";

describe("agent API authentication", () => {
  beforeEach(async () => {
    await resetDatabase();
    apiKey = (await getSettings()).storedApiKey!;
  });
  afterEach(() => {
    delete process.env.AGENT_API_KEYS;
  });

  it("rejects missing and invalid keys with 401", async () => {
    const missing = await listRoute(agentRequest("/api/v1/requests", null));
    expect(missing.status).toBe(401);
    expect((await missing.json()).error.code).toBe("unauthorized");
    const wrong = await listRoute(agentRequest("/api/v1/requests", "cpi_demo_not_the_key"));
    expect(wrong.status).toBe(401);
  });

  it("accepts the generated demo key", async () => {
    const res = await listRoute(agentRequest("/api/v1/requests?priority=high&pageSize=5", apiKey));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeLessThanOrEqual(5);
    expect(body.pagination.total).toBeGreaterThan(0);
    expect(body.data.every((r: { priority: string }) => r.priority === "high")).toBe(true);
  });

  it("uses only environment keys when AGENT_API_KEYS is set", async () => {
    process.env.AGENT_API_KEYS = "cpi_live_env_key_one,cpi_live_env_key_two";
    expect((await listRoute(agentRequest("/api/v1/requests", apiKey))).status).toBe(401);
    expect((await listRoute(agentRequest("/api/v1/requests", "cpi_live_env_key_two"))).status).toBe(200);
  });

  it("validates filters with 422", async () => {
    const res = await listRoute(agentRequest("/api/v1/requests?status=bogus", apiKey));
    expect(res.status).toBe(422);
  });
});

describe("agent API processing flow", () => {
  beforeEach(async () => {
    await resetDatabase();
    apiKey = (await getSettings()).storedApiKey!;
  });

  it("discovers, claims, updates, and completes a queued request", async () => {
    const queued = await queueRoute(uiRequest("/api/requests/CPI-1004/queue", { body: {} }), params("CPI-1004"));
    expect(queued.status).toBe(201);
    const repeat = await queueRoute(uiRequest("/api/requests/CPI-1004/queue", { body: {} }), params("CPI-1004"));
    expect(repeat.status).toBe(200);
    expect((await repeat.json()).created).toBe(false);

    const discovered = await (await listRoute(agentRequest("/api/v1/requests?automationStatus=queued", apiKey))).json();
    expect(discovered.data.map((r: { id: string }) => r.id)).toContain("CPI-1004");

    const detail = await (await getRoute(agentRequest("/api/v1/requests/CPI-1004", apiKey), params("CPI-1004"))).json();
    expect(detail.data.automation.currentJob.status).toBe("queued");
    expect(detail.data.request.content.requestedOutcome).toBeTruthy();

    const claimRes = await claimRoute(agentRequest("/api/v1/requests/CPI-1004/claim", apiKey, { body: { workerId: "cursor-automation" } }), params("CPI-1004"));
    expect(claimRes.status).toBe(200);
    const { claimToken } = (await claimRes.json()).data;
    const second = await claimRoute(agentRequest("/api/v1/requests/CPI-1004/claim", apiKey, { body: { workerId: "other" } }), params("CPI-1004"));
    expect(second.status).toBe(409);

    const status = await statusRoute(agentRequest("/api/v1/requests/CPI-1004/automation-status", apiKey, { body: { claimToken, status: "processing", message: "Drafting engineering ticket" } }), params("CPI-1004"));
    expect(status.status).toBe(200);

    const ref = await referenceRoute(agentRequest("/api/v1/requests/CPI-1004/external-reference", apiKey, { method: "PUT", body: { claimToken, issueKey: "MOB-881", issueUrl: "https://example.atlassian.net/browse/MOB-881" } }), params("CPI-1004"));
    expect(ref.status).toBe(200);
    expect((await ref.json()).data.changed).toBe(true);

    const badRef = await referenceRoute(agentRequest("/api/v1/requests/CPI-1004/external-reference", apiKey, { method: "PUT", body: { claimToken, issueKey: "bad key", issueUrl: "http://insecure" } }), params("CPI-1004"));
    expect(badRef.status).toBe(422);

    const result = await resultRoute(agentRequest("/api/v1/requests/CPI-1004/result", apiKey, { body: { claimToken, outcome: "completed", summary: "Created MOB-881 with acceptance criteria." } }), params("CPI-1004"));
    expect(result.status).toBe(200);
    const replay = await resultRoute(agentRequest("/api/v1/requests/CPI-1004/result", apiKey, { body: { claimToken, outcome: "completed", summary: "Created MOB-881 with acceptance criteria." } }), params("CPI-1004"));
    expect((await replay.json()).data.replayed).toBe(true);

    const finalDetail = await (await getRoute(agentRequest("/api/v1/requests/CPI-1004", apiKey), params("CPI-1004"))).json();
    expect(finalDetail.data.automation.status).toBe("completed");
    expect(finalDetail.data.externalReference).toMatchObject({ key: "MOB-881", isSample: false });

    const activity = await (await activityRoute(agentRequest("/api/v1/requests/CPI-1004/activity", apiKey), params("CPI-1004"))).json();
    const types = activity.data.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(["automation.queued", "automation.claimed", "external_reference.attached", "automation.completed"]));
  });

  it("accepts GitHub issue references", async () => {
    await queueRoute(uiRequest("/api/requests/CPI-1006/queue", { body: {} }), params("CPI-1006"));
    const claim = await (await claimRoute(agentRequest("/api/v1/requests/CPI-1006/claim", apiKey, { body: { workerId: "gh" } }), params("CPI-1006"))).json();
    const ref = await referenceRoute(
      agentRequest("/api/v1/requests/CPI-1006/external-reference", apiKey, {
        method: "PUT",
        body: { claimToken: claim.data.claimToken, issueKey: "example-org/product-backlog#12", issueUrl: "https://github.com/example-org/product-backlog/issues/12", system: "github" },
      }),
      params("CPI-1006"),
    );
    expect(ref.status).toBe(200);
  });

  it("returns 404 for unknown requests and 422 for invalid claim bodies", async () => {
    expect((await getRoute(agentRequest("/api/v1/requests/CPI-0001", apiKey), params("CPI-0001"))).status).toBe(404);
    const bad = await claimRoute(agentRequest("/api/v1/requests/CPI-1004/claim", apiKey, { body: { workerId: "" } }), params("CPI-1004"));
    expect(bad.status).toBe(422);
  });
});
