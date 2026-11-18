import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { WEBHOOK_EVENT_TYPES, type JobStatus } from "@/lib/domain";
import { config } from "./config";
import { sql, withTransaction, type Queryable } from "./db";
import { ApiError, conflict, notFound } from "./http";
import { getRequest, recordActivity, type ActorRef } from "./requests";
import { getSettings } from "./settings";
import { buildQueuedEvent, buildTestEvent, newCorrelationId, newEventId } from "./webhooks/envelope";
import { deliverNow, enqueueDelivery } from "./webhooks/dispatcher";

export interface JobRow {
  id: string;
  request_id: string;
  revision: number;
  event_id: string;
  correlation_id: string;
  status: JobStatus;
  claimed_by: string | null;
  claim_token: string | null;
  lease_expires_at: Date | null;
  claim_count: number;
  status_message: string | null;
  result_summary: string | null;
  error_message: string | null;
  result: unknown;
  queued_by: string;
  is_sample: boolean;
  created_at: Date;
  updated_at: Date;
  claimed_at: Date | null;
  completed_at: Date | null;
}

export interface JobView {
  id: string;
  requestId: string;
  revision: number;
  eventId: string;
  correlationId: string;
  status: JobStatus;
  claimedBy: string | null;
  leaseExpiresAt: string | null;
  claimCount: number;
  statusMessage: string | null;
  resultSummary: string | null;
  errorMessage: string | null;
  queuedBy: string;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
  completedAt: string | null;
}

const isoOrNull = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export function toJobView(row: JobRow): JobView {
  return {
    id: row.id,
    requestId: row.request_id,
    revision: row.revision,
    eventId: row.event_id,
    correlationId: row.correlation_id,
    status: row.status,
    claimedBy: row.claimed_by,
    leaseExpiresAt: isoOrNull(row.lease_expires_at),
    claimCount: row.claim_count,
    statusMessage: row.status_message,
    resultSummary: row.result_summary,
    errorMessage: row.error_message,
    queuedBy: row.queued_by,
    isSample: row.is_sample,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    claimedAt: isoOrNull(row.claimed_at),
    completedAt: isoOrNull(row.completed_at),
  };
}

function newJobId() {
  return `job_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function newClaimToken() {
  return `clm_${randomBytes(24).toString("base64url")}`;
}

function environmentName() {
  return config.demoMode ? "demo" : "production";
}

export interface QueueOutcome {
  job: JobView;
  created: boolean;
  deliveryId: string | null;
  delivery: Awaited<ReturnType<typeof deliverNow>> | null;
  webhookEnabled: boolean;
}

/**
 * Queues the current revision of a request for automation. Idempotent: if an active job
 * already exists for this revision, it is returned and no new event is created.
 */
export async function queueRequest(
  requestId: string,
  actor: ActorRef,
  options: { baseUrl: string; force?: boolean; reason?: "manual" | "auto" } ,
): Promise<QueueOutcome> {
  const result = await withTransaction(async (tx) => {
    const [locked] = await tx.query<{ id: string; revision: number }>(
      "select id, revision from requests where id = $1 for update",
      [requestId.toUpperCase()],
    );
    if (!locked) throw notFound(`Request ${requestId}`);
    const id = locked.id;
    const revision = Number(locked.revision);

    const [active] = await tx.query<JobRow>(
      `select * from automation_jobs where request_id = $1 and status in ('queued', 'processing') order by created_at desc limit 1`,
      [id],
    );
    if (active && active.revision === revision) {
      return { job: active, created: false, deliveryId: null as string | null };
    }
    if (!options.force) {
      const [done] = await tx.query<JobRow>(
        `select * from automation_jobs where request_id = $1 and revision = $2 and status in ('completed', 'failed')
         order by created_at desc limit 1`,
        [id, revision],
      );
      if (done) {
        throw conflict(
          "already_processed",
          `Revision ${revision} was already processed (${done.status}). Use Re-queue to send it again.`,
          { jobId: done.id, status: done.status },
        );
      }
    }
    if (active) {
      await tx.query(
        `update automation_jobs set status = 'superseded', claim_token = null, lease_expires_at = null, updated_at = now(),
           status_message = $2 where id = $1`,
        [active.id, `Superseded by revision ${revision}`],
      );
      await recordActivity(tx, id, actor, "automation.superseded",
        `Automation job for revision ${active.revision} superseded by revision ${revision}`, { jobId: active.id });
    }

    const jobId = newJobId();
    const eventId = newEventId();
    const correlationId = newCorrelationId();
    const [job] = await tx.query<JobRow>(
      `insert into automation_jobs (id, request_id, revision, event_id, correlation_id, status, queued_by)
       values ($1, $2, $3, $4, $5, 'queued', $6) returning *`,
      [jobId, id, revision, eventId, correlationId, actor.name],
    );
    await tx.query(
      `update requests set automation_status = 'queued', automation_summary = null, automation_updated_at = now() where id = $1`,
      [id],
    );

    const settings = await getSettings(tx);
    await recordActivity(
      tx,
      id,
      actor,
      "automation.queued",
      options.reason === "auto"
        ? `Automatically queued for automation on submission (revision ${revision})`
        : `Queued for automation (revision ${revision})`,
      { jobId, eventId, correlationId, revision, webhook: settings.enabled ? settings.destination : "disabled" },
    );

    let deliveryId: string | null = null;
    if (settings.enabled) {
      const request = await getRequest(id, tx);
      const payload = buildQueuedEvent({
        request: request!,
        eventId,
        correlationId,
        jobId,
        includeClientIdentity: settings.includeClientIdentity,
        baseUrl: options.baseUrl,
        environment: environmentName(),
      });
      deliveryId = await enqueueDelivery(tx, {
        eventId,
        eventType: WEBHOOK_EVENT_TYPES.requestQueued,
        requestId: id,
        jobId,
        payload,
        settings,
      });
    }
    return { job, created: true, deliveryId };
  });

  const settings = await getSettings();
  const delivery = result.deliveryId ? await deliverNow(result.deliveryId).catch(() => null) : null;
  return {
    job: toJobView(result.job),
    created: result.created,
    deliveryId: result.deliveryId,
    delivery,
    webhookEnabled: settings.enabled,
  };
}

export async function sendTestEvent(actor: ActorRef, baseUrl: string) {
  const settings = await getSettings();
  if (!settings.enabled) throw new ApiError(409, "integration_disabled", "Enable the webhook connection before sending a test event.");
  const eventId = newEventId();
  const payload = buildTestEvent({ eventId, baseUrl, environment: environmentName(), actor: actor.name });
  const deliveryId = await enqueueDelivery({ query: sql }, {
    eventId,
    eventType: WEBHOOK_EVENT_TYPES.test,
    requestId: null,
    jobId: null,
    payload,
    settings,
    isTest: true,
  });
  const delivery = await deliverNow(deliveryId);
  return { deliveryId, eventId, delivery };
}

const AUTOMATION_ACTOR = (workerId: string): ActorRef => ({ type: "automation", id: null, name: workerId });

/** Returns jobs whose lease expired to the queue so another worker can claim them. */
export async function releaseExpiredLeases() {
  const expired = await sql<{ id: string; request_id: string; claimed_by: string | null }>(
    `update automation_jobs set status = 'queued', claim_token = null, lease_expires_at = null, updated_at = now(),
       status_message = 'Lease expired; returned to queue'
     where status = 'processing' and lease_expires_at < now()
     returning id, request_id, claimed_by`,
  );
  for (const job of expired) {
    await sql(
      `update requests set automation_status = 'queued', automation_updated_at = now()
       where id = $1 and automation_status = 'processing'`,
      [job.request_id],
    );
    await recordActivity({ query: sql }, job.request_id, { type: "system", id: null, name: "Automation lease monitor" },
      "automation.lease_expired", `Processing lease held by ${job.claimed_by ?? "a worker"} expired; returned to the queue`, { jobId: job.id });
  }
  return expired.length;
}

async function finishClaim(tx: Queryable, job: JobRow, workerId: string) {
  await tx.query(`update requests set automation_status = 'processing', automation_updated_at = now() where id = $1`, [job.request_id]);
  await recordActivity(tx, job.request_id, AUTOMATION_ACTOR(workerId), "automation.claimed",
    `Claimed for processing by ${workerId}${job.claim_count > 1 ? ` (claim #${job.claim_count})` : ""}`,
    { jobId: job.id, revision: job.revision, leaseExpiresAt: isoOrNull(job.lease_expires_at) });
}

export interface ClaimResult {
  job: JobView;
  claimToken: string;
  leaseExpiresAt: string;
}

/**
 * Atomically claims the active job for a request. A conditional UPDATE guarantees that at most
 * one worker receives a claim token while the lease is valid.
 */
export async function claimRequest(requestId: string, workerId: string, leaseSeconds?: number): Promise<ClaimResult> {
  await releaseExpiredLeases();
  const id = requestId.toUpperCase();
  const lease = leaseSeconds ?? config.defaultLeaseSeconds;
  const token = newClaimToken();
  return withTransaction(async (tx) => {
    const [job] = await tx.query<JobRow>(
      `update automation_jobs set status = 'processing', claimed_by = $2, claim_token = $3,
         lease_expires_at = now() + make_interval(secs => $4), claim_count = claim_count + 1, claimed_at = now(),
         status_message = 'Claimed', updated_at = now()
       where id = (
         select id from automation_jobs
         where request_id = $1 and (status = 'queued' or (status = 'processing' and lease_expires_at < now()))
         order by created_at desc limit 1
         for update skip locked)
       and (status = 'queued' or (status = 'processing' and lease_expires_at < now()))
       returning *`,
      [id, workerId, token, lease],
    );
    if (!job) {
      const [exists] = await tx.query("select id from requests where id = $1", [id]);
      if (!exists) throw notFound(`Request ${id}`);
      const [active] = await tx.query<JobRow>(
        `select * from automation_jobs where request_id = $1 and status in ('queued','processing') order by created_at desc limit 1`,
        [id],
      );
      if (active?.status === "processing") {
        throw conflict("already_claimed", `Request ${id} is already being processed by another worker.`, {
          claimedBy: active.claimed_by,
          leaseExpiresAt: isoOrNull(active.lease_expires_at),
        });
      }
      throw conflict("not_queued", `Request ${id} is not queued for automation.`);
    }
    await finishClaim(tx, job, workerId);
    return { job: toJobView(job), claimToken: token, leaseExpiresAt: isoOrNull(job.lease_expires_at)! };
  });
}

/** Claims the oldest queued job across all requests, or returns null when the queue is empty. */
export async function claimNext(workerId: string, leaseSeconds?: number): Promise<ClaimResult | null> {
  await releaseExpiredLeases();
  const lease = leaseSeconds ?? config.defaultLeaseSeconds;
  const token = newClaimToken();
  return withTransaction(async (tx) => {
    const [job] = await tx.query<JobRow>(
      `update automation_jobs set status = 'processing', claimed_by = $1, claim_token = $2,
         lease_expires_at = now() + make_interval(secs => $3), claim_count = claim_count + 1, claimed_at = now(),
         status_message = 'Claimed', updated_at = now()
       where id = (
         select id from automation_jobs where status = 'queued' and not is_sample
         order by created_at asc limit 1
         for update skip locked)
       and status = 'queued'
       returning *`,
      [workerId, token, lease],
    );
    if (!job) return null;
    await finishClaim(tx, job, workerId);
    return { job: toJobView(job), claimToken: token, leaseExpiresAt: isoOrNull(job.lease_expires_at)! };
  });
}

async function jobForToken(tx: Queryable, requestId: string, claimToken: string) {
  const [exists] = await tx.query("select id from requests where id = $1", [requestId]);
  if (!exists) throw notFound(`Request ${requestId}`);
  const [job] = await tx.query<JobRow>(
    `select * from automation_jobs where request_id = $1 and claim_token = $2 for update`,
    [requestId, claimToken],
  );
  if (!job) {
    throw conflict(
      "stale_claim",
      "The claim token is not valid for this request. The lease may have expired, been reclaimed, or been superseded by a newer revision.",
    );
  }
  return job;
}

export async function updateAutomationStatus(
  requestId: string,
  input: { claimToken: string; status: "processing"; message?: string; leaseSeconds?: number },
) {
  const id = requestId.toUpperCase();
  return withTransaction(async (tx) => {
    const job = await jobForToken(tx, id, input.claimToken);
    if (job.status !== "processing") {
      throw conflict("job_not_processing", `This job is ${job.status}; status updates are only accepted while processing.`);
    }
    const [updated] = await tx.query<JobRow>(
      `update automation_jobs set status_message = coalesce($2, status_message),
         lease_expires_at = case when $3::int is null then lease_expires_at else now() + make_interval(secs => $3::int) end,
         updated_at = now()
       where id = $1 returning *`,
      [job.id, input.message ?? null, input.leaseSeconds ?? null],
    );
    await tx.query(`update requests set automation_updated_at = now() where id = $1`, [id]);
    if (input.message && input.message !== job.status_message) {
      await recordActivity(tx, id, AUTOMATION_ACTOR(job.claimed_by ?? "automation"), "automation.status_updated",
        `Automation update: ${input.message}`, { jobId: job.id });
    }
    return toJobView(updated);
  });
}

async function applyExternalReference(
  tx: Queryable,
  id: string,
  job: JobRow,
  ref: { issueKey: string; issueUrl: string; system: string },
) {
  const [current] = await tx.query<{ external_issue_key: string | null; external_issue_url: string | null }>(
    "select external_issue_key, external_issue_url from requests where id = $1",
    [id],
  );
  if (current?.external_issue_key === ref.issueKey && current?.external_issue_url === ref.issueUrl) return false;
  await tx.query(
    `update requests set external_issue_key = $2, external_issue_url = $3, external_issue_system = $4,
       external_ref_is_sample = false, external_ref_updated_at = now() where id = $1`,
    [id, ref.issueKey, ref.issueUrl, ref.system],
  );
  await recordActivity(tx, id, AUTOMATION_ACTOR(job.claimed_by ?? "automation"), "external_reference.attached",
    `External reference ${ref.issueKey} attached`, { key: ref.issueKey, url: ref.issueUrl, system: ref.system, jobId: job.id });
  return true;
}

export async function attachExternalReference(
  requestId: string,
  input: { claimToken: string; issueKey: string; issueUrl: string; system: string },
) {
  const id = requestId.toUpperCase();
  return withTransaction(async (tx) => {
    const job = await jobForToken(tx, id, input.claimToken);
    if (job.status === "superseded") throw conflict("superseded", "This job was superseded by a newer revision.");
    const changed = await applyExternalReference(tx, id, job, input);
    return { changed, issueKey: input.issueKey, issueUrl: input.issueUrl, system: input.system };
  });
}

export async function recordResult(
  requestId: string,
  input: {
    claimToken: string;
    outcome: "completed" | "failed";
    summary: string;
    error?: string;
    externalIssue?: { key: string; url: string; system: string };
    details?: Record<string, unknown>;
  },
) {
  const id = requestId.toUpperCase();
  return withTransaction(async (tx) => {
    const job = await jobForToken(tx, id, input.claimToken);
    const [request] = await tx.query<{ revision: number }>("select revision from requests where id = $1", [id]);
    const currentRevision = Number(request.revision);
    if (job.status === "superseded") {
      throw conflict("superseded", "This job was superseded by a newer revision; the result was not recorded.");
    }
    if (job.status === "completed" || job.status === "failed") {
      if (job.status === input.outcome) {
        return { job: toJobView(job), replayed: true, currentRevision, revisionChangedSinceQueued: currentRevision !== job.revision };
      }
      throw conflict("already_finalized", `This job was already finalized as ${job.status}.`);
    }
    if (job.status !== "processing") throw conflict("job_not_processing", "This job is not being processed.");

    const [updated] = await tx.query<JobRow>(
      `update automation_jobs set status = $2, result_summary = $3, error_message = $4, result = $5,
         status_message = $6, completed_at = now(), lease_expires_at = null, updated_at = now()
       where id = $1 returning *`,
      [
        job.id,
        input.outcome,
        input.summary,
        input.outcome === "failed" ? (input.error ?? null) : null,
        JSON.stringify({ details: input.details ?? {}, externalIssue: input.externalIssue ?? null }),
        input.outcome === "completed" ? "Completed" : "Failed",
      ],
    );
    await tx.query(
      `update requests set automation_status = $2, automation_summary = $3, automation_updated_at = now() where id = $1`,
      [id, input.outcome, input.outcome === "failed" ? `${input.summary}${input.error ? ` — ${input.error}` : ""}` : input.summary],
    );
    const actor = AUTOMATION_ACTOR(job.claimed_by ?? "automation");
    await recordActivity(
      tx,
      id,
      actor,
      input.outcome === "completed" ? "automation.completed" : "automation.failed",
      input.outcome === "completed" ? `Automation completed: ${input.summary}` : `Automation failed: ${input.error ?? input.summary}`,
      { jobId: job.id, revision: job.revision, currentRevision },
    );
    if (input.externalIssue) {
      await applyExternalReference(tx, id, job, {
        issueKey: input.externalIssue.key,
        issueUrl: input.externalIssue.url,
        system: input.externalIssue.system,
      });
    }
    return { job: toJobView(updated), replayed: false, currentRevision, revisionChangedSinceQueued: currentRevision !== job.revision };
  });
}

export async function listJobs(requestId: string): Promise<JobView[]> {
  const rows = await sql<JobRow>(`select * from automation_jobs where request_id = $1 order by created_at desc`, [
    requestId.toUpperCase(),
  ]);
  return rows.map(toJobView);
}

export async function automationOverview() {
  const [row] = await sql<{ queued: number; processing: number; completed: number; failed: number }>(
    `select count(*) filter (where automation_status = 'queued')::int as queued,
            count(*) filter (where automation_status = 'processing')::int as processing,
            count(*) filter (where automation_status = 'completed')::int as completed,
            count(*) filter (where automation_status = 'failed')::int as failed
     from requests`,
  );
  return row;
}
