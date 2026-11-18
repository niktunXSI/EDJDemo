import { beforeEach, describe, expect, it } from "vitest";
import {
  attachExternalReference,
  claimNext,
  claimRequest,
  queueRequest,
  recordResult,
  releaseExpiredLeases,
  updateAutomationStatus,
} from "@/lib/server/automation";
import { sql } from "@/lib/server/db";
import { ApiError } from "@/lib/server/http";
import { getActivity, getRequest, updateRequest } from "@/lib/server/requests";
import { resetDatabase, USER } from "./support/helpers";

const BASE = { baseUrl: "http://localhost:4317" };
const REQUEST = "CPI-1006";

async function expectApiError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(status);
  expect((error as ApiError).code).toBe(code);
}

describe("queueing and idempotency", () => {
  beforeEach(resetDatabase);

  it("persists queued state, an automation event, and an outbox delivery", async () => {
    const outcome = await queueRequest(REQUEST, USER, BASE);
    expect(outcome.created).toBe(true);
    expect(outcome.job.status).toBe("queued");
    expect(outcome.delivery?.status).toBe("delivered");
    const request = await getRequest(REQUEST);
    expect(request?.automationStatus).toBe("queued");
    const types = (await getActivity(REQUEST)).map((e) => e.eventType);
    expect(types).toContain("automation.queued");
    expect(types).toContain("webhook.delivered");
  });

  it("does not create duplicate events for repeated queueing of the same revision", async () => {
    const results = await Promise.all([queueRequest(REQUEST, USER, BASE), queueRequest(REQUEST, USER, BASE), queueRequest(REQUEST, USER, BASE)]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.job.eventId)).size).toBe(1);
    const [counts] = await sql<{ jobs: number; deliveries: number; events: number }>(
      `select (select count(*)::int from automation_jobs where request_id = $1) as jobs,
              (select count(*)::int from webhook_deliveries where request_id = $1) as deliveries,
              (select count(*)::int from activity_events where request_id = $1 and event_type = 'automation.queued') as events`,
      [REQUEST],
    );
    expect(counts).toEqual({ jobs: 1, deliveries: 1, events: 1 });
  });

  it("supersedes the active job when a newer revision is queued", async () => {
    const first = await queueRequest(REQUEST, USER, BASE);
    await updateRequest(REQUEST, { priority: "critical" }, USER);
    const second = await queueRequest(REQUEST, USER, BASE);
    expect(second.created).toBe(true);
    expect(second.job.revision).toBe(first.job.revision + 1);
    expect(second.job.eventId).not.toBe(first.job.eventId);
    const [old] = await sql<{ status: string }>("select status from automation_jobs where id = $1", [first.job.id]);
    expect(old.status).toBe("superseded");
  });

  it("requires force to re-queue an already processed revision", async () => {
    await queueRequest(REQUEST, USER, BASE);
    const claim = await claimRequest(REQUEST, "worker-a");
    await recordResult(REQUEST, { claimToken: claim.claimToken, outcome: "completed", summary: "Ticket drafted." });
    await expectApiError(queueRequest(REQUEST, USER, BASE), 409, "already_processed");
    const forced = await queueRequest(REQUEST, USER, { ...BASE, force: true });
    expect(forced.created).toBe(true);
  });
});

describe("claims, leases, and results", () => {
  beforeEach(resetDatabase);

  it("allows exactly one of many concurrent claims to succeed", async () => {
    await queueRequest(REQUEST, USER, BASE);
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => claimRequest(REQUEST, `worker-${i}`, 120)),
    );
    const winners = attempts.filter((a) => a.status === "fulfilled");
    const losers = attempts.filter((a) => a.status === "rejected") as PromiseRejectedResult[];
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(5);
    for (const loser of losers) expect((loser.reason as ApiError).code).toBe("already_claimed");
    expect((await getRequest(REQUEST))?.automationStatus).toBe("processing");
  });

  it("claim-next hands distinct jobs to concurrent workers", async () => {
    await queueRequest("CPI-1004", USER, BASE);
    await queueRequest("CPI-1006", USER, BASE);
    const claims = await Promise.all([claimNext("w1"), claimNext("w2"), claimNext("w3")]);
    const claimed = claims.filter(Boolean).map((c) => c!.job.requestId);
    expect(claimed.sort()).toEqual(["CPI-1004", "CPI-1006"]);
    expect(claims.filter((c) => c === null)).toHaveLength(1);
  });

  it("rejects claims for requests that are not queued", async () => {
    await expectApiError(claimRequest("CPI-1004", "worker-a"), 409, "not_queued");
    await expectApiError(claimRequest("CPI-9999", "worker-a"), 404, "not_found");
  });

  it("records results idempotently and attaches the external reference", async () => {
    await queueRequest(REQUEST, USER, BASE);
    const claim = await claimRequest(REQUEST, "worker-a");
    await updateAutomationStatus(REQUEST, { claimToken: claim.claimToken, status: "processing", message: "Drafting ticket", leaseSeconds: 600 });
    const input = {
      claimToken: claim.claimToken,
      outcome: "completed" as const,
      summary: "Engineering ticket created.",
      externalIssue: { key: "CPI-ENG-42", url: "https://example.atlassian.net/browse/CPI-ENG-42", system: "jira" },
    };
    const first = await recordResult(REQUEST, input);
    expect(first.replayed).toBe(false);
    const replay = await recordResult(REQUEST, input);
    expect(replay.replayed).toBe(true);
    await expectApiError(recordResult(REQUEST, { ...input, outcome: "failed", error: "boom" }), 409, "already_finalized");

    const request = await getRequest(REQUEST);
    expect(request?.automationStatus).toBe("completed");
    expect(request?.externalIssue).toMatchObject({ key: "CPI-ENG-42", isSample: false });
    const again = await attachExternalReference(REQUEST, { claimToken: claim.claimToken, issueKey: "CPI-ENG-42", issueUrl: input.externalIssue.url, system: "jira" });
    expect(again.changed).toBe(false);
    const completedEvents = (await getActivity(REQUEST)).filter((e) => e.eventType === "automation.completed");
    expect(completedEvents).toHaveLength(1);
  });

  it("records failures and rejects stale claim tokens after a lease expires and is reclaimed", async () => {
    await queueRequest(REQUEST, USER, BASE);
    const stale = await claimRequest(REQUEST, "worker-a", 30);
    await sql("update automation_jobs set lease_expires_at = now() - interval '1 second' where request_id = $1", [REQUEST]);
    expect(await releaseExpiredLeases()).toBe(1);
    expect((await getRequest(REQUEST))?.automationStatus).toBe("queued");
    const fresh = await claimRequest(REQUEST, "worker-b");
    await expectApiError(
      recordResult(REQUEST, { claimToken: stale.claimToken, outcome: "completed", summary: "late" }),
      409,
      "stale_claim",
    );
    const failed = await recordResult(REQUEST, { claimToken: fresh.claimToken, outcome: "failed", summary: "Could not draft ticket", error: "Project mapping missing" });
    expect(failed.job.status).toBe("failed");
    expect((await getRequest(REQUEST))?.automationStatus).toBe("failed");
  });

  it("rejects results for superseded revisions", async () => {
    await queueRequest(REQUEST, USER, BASE);
    const claim = await claimRequest(REQUEST, "worker-a");
    await updateRequest(REQUEST, { title: "Assemble client review packets as one PDF" }, USER);
    await queueRequest(REQUEST, USER, BASE);
    await expectApiError(
      recordResult(REQUEST, { claimToken: claim.claimToken, outcome: "completed", summary: "old" }),
      409,
      "stale_claim",
    );
  });
});
