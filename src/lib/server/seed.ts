import { randomBytes } from "node:crypto";
import { PRIORITY_LABELS, STATUS_LABELS, type RequestStatus } from "@/lib/domain";
import { config } from "./config";
import type { Queryable } from "./db";
import { seedAdvisors, seedClients, seedRequests, seedTeam, type SeedRequest } from "./seed-data";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function generateSigningSecret() {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export function generateApiKey() {
  return `cpi_demo_${randomBytes(24).toString("base64url")}`;
}

/** Creates the singleton integration settings row with generated credentials. */
export async function ensureIntegrationConfig(q: Queryable) {
  await q.query(
    `insert into webhook_config (id, enabled, destination, secret, agent_api_key)
     values (1, true, 'mock', $1, $2)
     on conflict (id) do nothing`,
    [generateSigningSecret(), generateApiKey()],
  );
}

export async function initialiseData(q: Queryable, tx: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>) {
  await ensureIntegrationConfig(q);
  if (!config.seedOnEmpty) return;
  const [row] = await q.query<{ count: number }>("select count(*)::int as count from advisors");
  if (row && row.count > 0) return;
  await tx(async (t) => {
    await t.query("select pg_advisory_xact_lock(4242001)");
    const [again] = await t.query<{ count: number }>("select count(*)::int as count from advisors");
    if (again && again.count > 0) return;
    await insertSeed(t, new Date());
  });
}

export async function resetDemoData(t: Queryable) {
  await t.query("select pg_advisory_xact_lock(4242001)");
  await t.query(
    `truncate table mock_receiver_events, webhook_attempts, webhook_deliveries, automation_jobs,
       activity_events, notes, request_relations, requests, clients, advisors, team_members restart identity cascade`,
  );
  await insertSeed(t, new Date());
}

const STATUS_PATHS: Record<RequestStatus, RequestStatus[]> = {
  new: [],
  under_review: ["under_review"],
  planned: ["under_review", "planned"],
  in_progress: ["under_review", "planned", "in_progress"],
  delivered: ["under_review", "planned", "in_progress", "delivered"],
  declined: ["under_review", "declined"],
};

interface PendingEvent {
  at: Date;
  actorType: string;
  actorId: string | null;
  actorName: string;
  type: string;
  summary: string;
  details: Record<string, unknown>;
  sample?: boolean;
}

async function insertSeed(t: Queryable, now: Date) {
  for (const m of seedTeam) {
    await t.query(
      `insert into team_members (id, name, role, team, email, is_demo_persona) values ($1,$2,$3,$4,$5,$6)`,
      [m.id, m.name, m.role, m.team, emailFor(m.name, "cpi-demo.example"), m.persona],
    );
  }
  for (const a of seedAdvisors) {
    await t.query(
      `insert into advisors (id, name, branch, city, state, region, email, joined_year) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [a.id, a.name, a.branch, a.city, a.state, a.region, emailFor(a.name, "advisors.cpi-demo.example"), a.joinedYear],
    );
  }
  for (const c of seedClients) {
    await t.query(
      `insert into clients (id, household_name, primary_contact, city, state, region, relationship_since, segment, advisor_id, household_members, preferred_channel)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [c.id, c.householdName, c.primaryContact, c.city, c.state, c.region, c.since, c.segment, c.advisorId, c.members, c.preferredChannel],
    );
  }

  for (const r of seedRequests) {
    await insertSeedRequest(t, r, now);
  }
  for (const r of seedRequests) {
    for (const related of r.related ?? []) {
      await t.query(
        `insert into request_relations (request_id, related_request_id) values ($1, $2) on conflict do nothing`,
        [`CPI-${r.num}`, `CPI-${related}`],
      );
    }
  }
  const maxNum = Math.max(...seedRequests.map((r) => r.num));
  await t.query(`select setval('request_number_seq', $1, true)`, [maxNum]);
}

async function insertSeedRequest(t: Queryable, r: SeedRequest, now: Date) {
  const id = `CPI-${r.num}`;
  const advisor = seedAdvisors.find((a) => a.id === r.advisorId)!;
  const owner = seedTeam.find((m) => m.id === r.ownerId) ?? null;
  const submitted = new Date(now.getTime() - r.daysAgo * DAY - ((r.num * 37) % 9) * HOUR);
  const end = new Date(now.getTime() - 2 * HOUR);
  const span = Math.max(end.getTime() - submitted.getTime(), HOUR);
  const at = (fraction: number) => new Date(submitted.getTime() + span * fraction);
  const triage = owner?.team === "Service Operations" ? seedTeam[1] : seedTeam[0];

  const events: PendingEvent[] = [
    {
      at: submitted,
      actorType: "advisor",
      actorId: advisor.id,
      actorName: advisor.name,
      type: "request.submitted",
      summary: `Submitted by ${advisor.name}, ${advisor.branch}`,
      details: { priority: r.priority, productArea: r.area },
    },
  ];

  if (r.priorityChange) {
    events.push({
      at: at(0.06),
      actorType: "user",
      actorId: null,
      actorName: r.priorityChange.by,
      type: "priority.changed",
      summary: `Priority changed from ${PRIORITY_LABELS[r.priorityChange.from]} to ${PRIORITY_LABELS[r.priority]}`,
      details: { from: r.priorityChange.from, to: r.priority },
    });
  }
  if (owner) {
    events.push({
      at: at(0.08),
      actorType: "user",
      actorId: triage.id,
      actorName: triage.name,
      type: "request.assigned",
      summary: `Assigned to ${owner.name}`,
      details: { ownerId: owner.id },
    });
  }

  const path = STATUS_PATHS[r.status];
  path.forEach((status, index) => {
    const previous = index === 0 ? "new" : path[index - 1];
    const actor = owner ?? triage;
    events.push({
      at: at(0.15 + (0.7 * (index + 1)) / (path.length + 1)),
      actorType: "user",
      actorId: actor.id,
      actorName: actor.name,
      type: "status.changed",
      summary: `Status changed from ${STATUS_LABELS[previous]} to ${STATUS_LABELS[status]}`,
      details: { from: previous, to: status, ...(status === "declined" && r.declineReason ? { reason: r.declineReason } : {}) },
    });
  });

  const notes = [...(r.notes ?? [])];
  if (r.status === "declined" && r.declineReason) {
    notes.push({ author: (owner ?? triage).name, body: `Declined: ${r.declineReason}`, daysAfter: -1 });
  }
  const noteRows: { at: Date; author: string; body: string }[] = [];
  for (const note of notes) {
    const noteAt =
      note.daysAfter < 0
        ? at(0.86)
        : new Date(Math.min(submitted.getTime() + note.daysAfter * DAY + 3 * HOUR, end.getTime() - HOUR));
    noteRows.push({ at: noteAt, author: note.author, body: note.body });
    const author = seedTeam.find((m) => m.name === note.author);
    events.push({
      at: noteAt,
      actorType: "user",
      actorId: author?.id ?? null,
      actorName: note.author,
      type: "note.added",
      summary: "Added an internal note",
      details: { excerpt: note.body.slice(0, 140) },
    });
  }

  let automationStatus = "not_queued";
  let automationSummary: string | null = null;
  let automationAt: Date | null = null;
  let externalKey: string | null = null;
  let sampleJob: unknown[] | null = null;
  if (r.sampleAutomation) {
    const queuedAt = at(0.9);
    const claimedAt = new Date(queuedAt.getTime() + 2 * 60_000);
    const doneAt = new Date(queuedAt.getTime() + 7 * 60_000);
    const completed = r.sampleAutomation === "completed";
    automationStatus = completed ? "completed" : "failed";
    automationAt = doneAt;
    automationSummary = completed
      ? "Sample record: an engineering ticket draft was prepared from the request context."
      : "Sample record: the worker could not map this product area to a target engineering project.";
    externalKey = completed ? `SAMPLE-${r.num}` : null;
    sampleJob = [
      `job_sample_${r.num}`,
      id,
      `evt_sample_${r.num}`,
      `cor_sample_${r.num}`,
      automationStatus,
      completed ? "Completed" : "Failed",
      completed ? automationSummary : null,
      completed ? null : automationSummary,
      JSON.stringify({ sample: true }),
      seedTeam[0].name,
      queuedAt,
      doneAt,
      claimedAt,
    ];
    const sampleEvents: PendingEvent[] = [
      { at: queuedAt, actorType: "user", actorId: seedTeam[0].id, actorName: seedTeam[0].name, type: "automation.queued", summary: "Queued for automation (sample record)", details: { eventId: `evt_sample_${r.num}`, revision: 1 }, sample: true },
      { at: claimedAt, actorType: "automation", actorId: null, actorName: "sample-worker (seed data)", type: "automation.claimed", summary: "Claimed for processing by sample-worker (seed data)", details: {}, sample: true },
      completed
        ? { at: doneAt, actorType: "automation", actorId: null, actorName: "sample-worker (seed data)", type: "automation.completed", summary: "Automation completed (sample record)", details: { summary: automationSummary }, sample: true }
        : { at: doneAt, actorType: "automation", actorId: null, actorName: "sample-worker (seed data)", type: "automation.failed", summary: "Automation failed (sample record)", details: { error: automationSummary }, sample: true },
    ];
    if (completed) {
      sampleEvents.push({ at: doneAt, actorType: "automation", actorId: null, actorName: "sample-worker (seed data)", type: "external_reference.attached", summary: `External reference ${externalKey} attached (sample record, no live link)`, details: { key: externalKey, sample: true }, sample: true });
    }
    events.push(...sampleEvents);
  }

  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  const updatedAt = events[events.length - 1].at;

  await t.query(
    `insert into requests (id, title, request_type, client_id, advisor_id, product_area, channel, priority, status, automation_status,
       original_feedback, problem_statement, requested_outcome, current_workaround, business_impact, expected_benefit, owner_id, tags,
       revision, external_issue_key, external_issue_url, external_issue_system, external_ref_is_sample, external_ref_updated_at,
       automation_summary, automation_updated_at, is_sample, submitted_at, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,1,$19,null,$20,$21,$22,$23,$24,true,$25,$25,$26)`,
    [
      id, r.title, r.type, r.clientId, r.advisorId, r.area, r.channel, r.priority, r.status, automationStatus,
      r.feedback, r.problem, r.outcome, r.workaround, r.impact, r.benefit, r.ownerId, r.tags,
      externalKey, externalKey ? "jira" : null, externalKey !== null, externalKey ? automationAt : null,
      automationSummary, automationAt, submitted, updatedAt,
    ],
  );

  if (sampleJob) {
    await t.query(
      `insert into automation_jobs (id, request_id, revision, event_id, correlation_id, status, claimed_by, claim_count,
         status_message, result_summary, error_message, result, queued_by, is_sample, created_at, updated_at, claimed_at, completed_at)
       values ($1,$2,1,$3,$4,$5,'sample-worker (seed data)',1,$6,$7,$8,$9,$10,true,$11,$12,$13,$12)`,
      sampleJob,
    );
  }
  for (const note of noteRows) {
    const author = seedTeam.find((m) => m.name === note.author);
    await t.query(`insert into notes (request_id, author_id, author_name, body, created_at) values ($1,$2,$3,$4,$5)`, [
      id,
      author?.id ?? null,
      note.author,
      note.body,
      note.at,
    ]);
  }
  for (const e of events) {
    await t.query(
      `insert into activity_events (request_id, actor_type, actor_id, actor_name, event_type, summary, details, is_sample, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, e.actorType, e.actorId, e.actorName, e.type, e.summary, JSON.stringify(e.details), e.sample ?? false, e.at],
    );
  }
}

function emailFor(name: string, domain: string) {
  return `${name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "")}@${domain}`;
}
