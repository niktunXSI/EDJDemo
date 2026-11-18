import "server-only";
import {
  AUTOMATION_LABELS,
  CHANNEL_LABELS,
  PRIORITY_LABELS,
  PRODUCT_AREA_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  type AutomationStatus,
  type Channel,
  type Priority,
  type ProductArea,
  type RequestStatus,
  type RequestType,
} from "@/lib/domain";
import type { CreateRequestInput, ListQuery, UpdateRequestInput } from "@/lib/validation";
import { sql, withTransaction, type Queryable } from "./db";
import { ApiError, conflict, notFound } from "./http";

export interface ActorRef {
  type: "user" | "advisor" | "automation" | "system";
  id: string | null;
  name: string;
}

export interface RequestListItem {
  id: string;
  title: string;
  requestType: RequestType;
  productArea: ProductArea;
  channel: Channel;
  priority: Priority;
  status: RequestStatus;
  automationStatus: AutomationStatus;
  revision: number;
  tags: string[];
  submittedAt: string;
  updatedAt: string;
  client: { id: string; householdName: string; segment: string } | null;
  advisor: { id: string; name: string; branch: string };
  owner: { id: string; name: string } | null;
  externalIssue: { key: string; url: string | null; system: string | null; isSample: boolean } | null;
  isSample: boolean;
}

export interface RequestDetail extends RequestListItem {
  originalFeedback: string;
  problemStatement: string;
  requestedOutcome: string;
  currentWorkaround: string;
  businessImpact: string;
  expectedBenefit: string;
  automationSummary: string | null;
  automationUpdatedAt: string | null;
  clientDetail: {
    id: string;
    householdName: string;
    primaryContact: string;
    city: string;
    state: string;
    region: string;
    segment: string;
    relationshipSince: string;
    householdMembers: number;
    preferredChannel: string;
  } | null;
  advisorDetail: { id: string; name: string; branch: string; city: string; state: string; region: string; email: string };
  ownerDetail: { id: string; name: string; role: string; team: string } | null;
  related: { id: string; title: string; status: RequestStatus; priority: Priority }[];
}

export interface ActivityEvent {
  id: number;
  requestId: string | null;
  requestTitle?: string;
  actorType: string;
  actorName: string;
  eventType: string;
  summary: string;
  details: Record<string, unknown>;
  isSample: boolean;
  createdAt: string;
}

export interface Note {
  id: number;
  authorName: string;
  body: string;
  createdAt: string;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(String(v)).toISOString() : "");
const isoOrNull = (v: unknown) => (v ? iso(v) : null);

const LIST_COLUMNS = `
  r.id, r.title, r.request_type, r.product_area, r.channel, r.priority, r.status, r.automation_status, r.revision,
  r.tags, r.submitted_at, r.updated_at, r.is_sample,
  r.external_issue_key, r.external_issue_url, r.external_issue_system, r.external_ref_is_sample,
  c.id as client_id, c.household_name, c.segment,
  a.id as advisor_id, a.name as advisor_name, a.branch as advisor_branch,
  o.id as owner_id, o.name as owner_name`;

const LIST_JOINS = `
  from requests r
  left join clients c on c.id = r.client_id
  join advisors a on a.id = r.advisor_id
  left join team_members o on o.id = r.owner_id`;

type Row = Record<string, unknown>;

function mapListRow(row: Row): RequestListItem {
  return {
    id: row.id as string,
    title: row.title as string,
    requestType: row.request_type as RequestType,
    productArea: row.product_area as ProductArea,
    channel: row.channel as Channel,
    priority: row.priority as Priority,
    status: row.status as RequestStatus,
    automationStatus: row.automation_status as AutomationStatus,
    revision: Number(row.revision),
    tags: (row.tags as string[]) ?? [],
    submittedAt: iso(row.submitted_at),
    updatedAt: iso(row.updated_at),
    isSample: Boolean(row.is_sample),
    client: row.client_id
      ? { id: row.client_id as string, householdName: row.household_name as string, segment: row.segment as string }
      : null,
    advisor: { id: row.advisor_id as string, name: row.advisor_name as string, branch: row.advisor_branch as string },
    owner: row.owner_id ? { id: row.owner_id as string, name: row.owner_name as string } : null,
    externalIssue: row.external_issue_key
      ? {
          key: row.external_issue_key as string,
          url: (row.external_issue_url as string) ?? null,
          system: (row.external_issue_system as string) ?? null,
          isSample: Boolean(row.external_ref_is_sample),
        }
      : null,
  };
}

const PRIORITY_ORDER = `case r.priority when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end`;
const STATUS_ORDER = `case r.status when 'new' then 1 when 'under_review' then 2 when 'planned' then 3 when 'in_progress' then 4 when 'delivered' then 5 else 6 end`;
const AUTOMATION_ORDER = `case r.automation_status when 'failed' then 1 when 'processing' then 2 when 'queued' then 3 when 'completed' then 4 else 5 end`;

const SORTS: Record<ListQuery["sort"], string> = {
  id: "r.id",
  title: "lower(r.title)",
  submitted: "r.submitted_at",
  updated: "r.updated_at",
  priority: PRIORITY_ORDER,
  status: STATUS_ORDER,
  automation: AUTOMATION_ORDER,
};

function buildWhere(filters: ListQuery) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (n: string) => string, value: unknown) => {
    params.push(value);
    clauses.push(clause(`$${params.length}`));
  };
  if (filters.q) {
    const term = `%${filters.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    add(
      (p) => `(r.id ilike ${p} or r.title ilike ${p} or r.original_feedback ilike ${p} or r.problem_statement ilike ${p}
        or r.requested_outcome ilike ${p} or coalesce(c.household_name, '') ilike ${p} or coalesce(c.primary_contact, '') ilike ${p}
        or a.name ilike ${p} or array_to_string(r.tags, ' ') ilike ${p})`,
      term,
    );
  }
  if (filters.status?.length) add((p) => `r.status = any(${p}::text[])`, filters.status);
  if (filters.priority?.length) add((p) => `r.priority = any(${p}::text[])`, filters.priority);
  if (filters.productArea?.length) add((p) => `r.product_area = any(${p}::text[])`, filters.productArea);
  if (filters.requestType?.length) add((p) => `r.request_type = any(${p}::text[])`, filters.requestType);
  if (filters.automationStatus?.length) add((p) => `r.automation_status = any(${p}::text[])`, filters.automationStatus);
  if (filters.clientId) add((p) => `r.client_id = ${p}`, filters.clientId);
  if (filters.advisorId) add((p) => `r.advisor_id = ${p}`, filters.advisorId);
  if (filters.updatedSince) add((p) => `r.updated_at >= ${p}::timestamptz`, filters.updatedSince);
  return { where: clauses.length ? `where ${clauses.join(" and ")}` : "", params };
}

export async function listRequests(filters: ListQuery) {
  const { where, params } = buildWhere(filters);
  const [countRow] = await sql<{ total: number }>(`select count(*)::int as total ${LIST_JOINS} ${where}`, params);
  const total = countRow?.total ?? 0;
  const order = `${SORTS[filters.sort]} ${filters.dir === "asc" ? "asc" : "desc"}, r.submitted_at desc, r.id desc`;
  const offset = (filters.page - 1) * filters.pageSize;
  const rows = await sql<Row>(
    `select ${LIST_COLUMNS} ${LIST_JOINS} ${where} order by ${order} limit ${filters.pageSize} offset ${offset}`,
    params,
  );
  return {
    items: rows.map(mapListRow),
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
  };
}

/** All rows matching the filters (no pagination), for CSV export. */
export async function listAllRequests(filters: ListQuery, limit = 5000) {
  const { where, params } = buildWhere(filters);
  const order = `${SORTS[filters.sort]} ${filters.dir === "asc" ? "asc" : "desc"}, r.id desc`;
  const rows = await sql<Row>(`select ${LIST_COLUMNS} ${LIST_JOINS} ${where} order by ${order} limit ${limit}`, params);
  return rows.map(mapListRow);
}

export async function getRequest(id: string, q: Queryable = { query: sql }): Promise<RequestDetail | null> {
  const [row] = await q.query<Row>(
    `select ${LIST_COLUMNS},
       r.original_feedback, r.problem_statement, r.requested_outcome, r.current_workaround, r.business_impact,
       r.expected_benefit, r.automation_summary, r.automation_updated_at,
       c.primary_contact, c.city as client_city, c.state as client_state, c.region as client_region,
       c.relationship_since, c.household_members, c.preferred_channel,
       a.city as advisor_city, a.state as advisor_state, a.region as advisor_region, a.email as advisor_email,
       o.role as owner_role, o.team as owner_team
     ${LIST_JOINS} where r.id = $1`,
    [id.toUpperCase()],
  );
  if (!row) return null;
  const related = await q.query<Row>(
    `select r.id, r.title, r.status, r.priority from requests r
     where r.id in (
       select related_request_id from request_relations where request_id = $1
       union select request_id from request_relations where related_request_id = $1)
     order by r.id`,
    [row.id],
  );
  const base = mapListRow(row);
  return {
    ...base,
    originalFeedback: row.original_feedback as string,
    problemStatement: row.problem_statement as string,
    requestedOutcome: row.requested_outcome as string,
    currentWorkaround: row.current_workaround as string,
    businessImpact: row.business_impact as string,
    expectedBenefit: row.expected_benefit as string,
    automationSummary: (row.automation_summary as string) ?? null,
    automationUpdatedAt: isoOrNull(row.automation_updated_at),
    clientDetail: base.client
      ? {
          id: base.client.id,
          householdName: base.client.householdName,
          primaryContact: row.primary_contact as string,
          city: row.client_city as string,
          state: row.client_state as string,
          region: row.client_region as string,
          segment: base.client.segment,
          relationshipSince: iso(row.relationship_since).slice(0, 10),
          householdMembers: Number(row.household_members),
          preferredChannel: row.preferred_channel as string,
        }
      : null,
    advisorDetail: {
      ...base.advisor,
      city: row.advisor_city as string,
      state: row.advisor_state as string,
      region: row.advisor_region as string,
      email: row.advisor_email as string,
    },
    ownerDetail: base.owner
      ? { ...base.owner, role: row.owner_role as string, team: row.owner_team as string }
      : null,
    related: related.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      status: r.status as RequestStatus,
      priority: r.priority as Priority,
    })),
  };
}

export async function requireRequest(id: string, q?: Queryable) {
  const request = await getRequest(id, q);
  if (!request) throw notFound(`Request ${id}`);
  return request;
}

function mapActivity(row: Row): ActivityEvent {
  return {
    id: Number(row.id),
    requestId: (row.request_id as string) ?? null,
    requestTitle: (row.request_title as string) ?? undefined,
    actorType: row.actor_type as string,
    actorName: row.actor_name as string,
    eventType: row.event_type as string,
    summary: row.summary as string,
    details: (row.details as Record<string, unknown>) ?? {},
    isSample: Boolean(row.is_sample),
    createdAt: iso(row.created_at),
  };
}

export async function getActivity(requestId: string, limit = 200): Promise<ActivityEvent[]> {
  const rows = await sql<Row>(
    `select * from activity_events where request_id = $1 order by created_at desc, id desc limit $2`,
    [requestId.toUpperCase(), limit],
  );
  return rows.map(mapActivity);
}

export async function getRecentActivity(limit = 12): Promise<ActivityEvent[]> {
  const rows = await sql<Row>(
    `select e.*, r.title as request_title from activity_events e left join requests r on r.id = e.request_id
     order by e.created_at desc, e.id desc limit $1`,
    [limit],
  );
  return rows.map(mapActivity);
}

export async function getNotes(requestId: string): Promise<Note[]> {
  const rows = await sql<Row>(`select * from notes where request_id = $1 order by created_at desc, id desc`, [
    requestId.toUpperCase(),
  ]);
  return rows.map((r) => ({
    id: Number(r.id),
    authorName: r.author_name as string,
    body: r.body as string,
    createdAt: iso(r.created_at),
  }));
}

export async function recordActivity(
  q: Queryable,
  requestId: string | null,
  actor: ActorRef,
  eventType: string,
  summary: string,
  details: Record<string, unknown> = {},
) {
  await q.query(
    `insert into activity_events (request_id, actor_type, actor_id, actor_name, event_type, summary, details)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [requestId, actor.type, actor.id, actor.name, eventType, summary, JSON.stringify(details)],
  );
}

async function assertReferences(q: Queryable, input: { clientId?: string | null; advisorId?: string; ownerId?: string | null }) {
  if (input.advisorId) {
    const [a] = await q.query("select id from advisors where id = $1", [input.advisorId]);
    if (!a) throw new ApiError(422, "validation_failed", "The selected advisor does not exist.", { fields: [{ path: "advisorId", message: "Choose a valid advisor." }] });
  }
  if (input.clientId) {
    const [c] = await q.query("select id from clients where id = $1", [input.clientId]);
    if (!c) throw new ApiError(422, "validation_failed", "The selected client does not exist.", { fields: [{ path: "clientId", message: "Choose a valid client or household." }] });
  }
  if (input.ownerId) {
    const [o] = await q.query("select id from team_members where id = $1", [input.ownerId]);
    if (!o) throw new ApiError(422, "validation_failed", "The selected owner does not exist.", { fields: [{ path: "ownerId", message: "Choose a valid owner." }] });
  }
}

export async function createRequest(input: CreateRequestInput, actor: ActorRef) {
  return withTransaction(async (tx) => {
    await assertReferences(tx, input);
    const [row] = await tx.query<{ id: string }>(
      `insert into requests (id, title, request_type, client_id, advisor_id, product_area, channel, priority,
         original_feedback, problem_statement, requested_outcome, current_workaround, business_impact, expected_benefit, tags)
       values ('CPI-' || nextval('request_number_seq'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       returning id`,
      [
        input.title,
        input.requestType,
        input.clientId,
        input.advisorId,
        input.productArea,
        input.channel,
        input.priority,
        input.originalFeedback,
        input.problemStatement,
        input.requestedOutcome,
        input.currentWorkaround,
        input.businessImpact,
        input.expectedBenefit,
        input.tags,
      ],
    );
    const [advisor] = await tx.query<{ name: string; branch: string }>("select name, branch from advisors where id = $1", [
      input.advisorId,
    ]);
    await recordActivity(
      tx,
      row.id,
      actor,
      "request.submitted",
      `Submitted by ${actor.name} on behalf of ${advisor.name}, ${advisor.branch}`,
      { priority: input.priority, productArea: input.productArea },
    );
    return row.id;
  });
}

const CONTENT_FIELDS: { key: keyof UpdateRequestInput; column: string; label: string }[] = [
  { key: "title", column: "title", label: "title" },
  { key: "requestType", column: "request_type", label: "request type" },
  { key: "clientId", column: "client_id", label: "client" },
  { key: "advisorId", column: "advisor_id", label: "submitting advisor" },
  { key: "productArea", column: "product_area", label: "product area" },
  { key: "channel", column: "channel", label: "channel" },
  { key: "originalFeedback", column: "original_feedback", label: "original feedback" },
  { key: "problemStatement", column: "problem_statement", label: "problem statement" },
  { key: "requestedOutcome", column: "requested_outcome", label: "requested enhancement" },
  { key: "currentWorkaround", column: "current_workaround", label: "current workaround" },
  { key: "businessImpact", column: "business_impact", label: "business impact" },
  { key: "expectedBenefit", column: "expected_benefit", label: "expected benefit" },
  { key: "tags", column: "tags", label: "tags" },
];

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export async function updateRequest(id: string, input: UpdateRequestInput, actor: ActorRef) {
  return withTransaction(async (tx) => {
    const [current] = await tx.query<Row>("select * from requests where id = $1 for update", [id.toUpperCase()]);
    if (!current) throw notFound(`Request ${id}`);
    if (input.expectedRevision !== undefined && input.expectedRevision !== Number(current.revision)) {
      throw conflict(
        "revision_conflict",
        `This request was changed by someone else (now revision ${current.revision}). Reload to see the latest version.`,
        { currentRevision: Number(current.revision) },
      );
    }
    await assertReferences(tx, input);

    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    const changedContent: string[] = [];
    for (const field of CONTENT_FIELDS) {
      const value = input[field.key];
      if (value === undefined || sameValue(value, current[field.column])) continue;
      set(field.column, value);
      changedContent.push(field.label);
    }

    const events: [string, string, Record<string, unknown>][] = [];
    if (input.status !== undefined && input.status !== current.status) {
      set("status", input.status);
      events.push([
        "status.changed",
        `Status changed from ${STATUS_LABELS[current.status as RequestStatus]} to ${STATUS_LABELS[input.status]}`,
        { from: current.status, to: input.status, ...(input.statusReason ? { reason: input.statusReason } : {}) },
      ]);
    }
    if (input.priority !== undefined && input.priority !== current.priority) {
      set("priority", input.priority);
      events.push([
        "priority.changed",
        `Priority changed from ${PRIORITY_LABELS[current.priority as Priority]} to ${PRIORITY_LABELS[input.priority]}`,
        { from: current.priority, to: input.priority },
      ]);
    }
    if (input.ownerId !== undefined && input.ownerId !== current.owner_id) {
      set("owner_id", input.ownerId);
      if (input.ownerId) {
        const [owner] = await tx.query<{ name: string }>("select name from team_members where id = $1", [input.ownerId]);
        events.push(["request.assigned", `Assigned to ${owner.name}`, { from: current.owner_id, to: input.ownerId }]);
      } else {
        events.push(["request.unassigned", "Owner removed", { from: current.owner_id }]);
      }
    }
    if (changedContent.length) {
      events.push([
        "request.updated",
        `Updated ${formatList(changedContent)}`,
        { fields: changedContent, revision: Number(current.revision) + 1 },
      ]);
    }
    if (!sets.length) return { id: current.id as string, changed: false, revision: Number(current.revision) };

    sets.push("revision = revision + 1", "updated_at = now()");
    const [updated] = await tx.query<{ revision: number }>(
      `update requests set ${sets.join(", ")} where id = $${params.length + 1} returning revision`,
      [...params, current.id],
    );
    for (const [type, summary, details] of events) {
      await recordActivity(tx, current.id as string, actor, type, summary, details);
    }
    return { id: current.id as string, changed: true, revision: Number(updated.revision) };
  });
}

export async function addNote(id: string, body: string, actor: ActorRef) {
  return withTransaction(async (tx) => {
    const [request] = await tx.query<{ id: string }>("select id from requests where id = $1", [id.toUpperCase()]);
    if (!request) throw notFound(`Request ${id}`);
    const [note] = await tx.query<{ id: number }>(
      `insert into notes (request_id, author_id, author_name, body) values ($1, $2, $3, $4) returning id`,
      [request.id, actor.id, actor.name, body],
    );
    await tx.query("update requests set updated_at = now() where id = $1", [request.id]);
    await recordActivity(tx, request.id, actor, "note.added", "Added an internal note", { excerpt: body.slice(0, 140) });
    return Number(note.id);
  });
}

function formatList(items: string[]) {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  // Neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function requestsToCsv(items: RequestListItem[]) {
  const header = [
    "Request ID",
    "Title",
    "Client / Household",
    "Submitting Advisor",
    "Branch",
    "Product Area",
    "Request Type",
    "Channel",
    "Priority",
    "Business Status",
    "Automation Status",
    "Owner",
    "External Reference",
    "Tags",
    "Submitted",
    "Last Updated",
  ];
  const lines = items.map((r) =>
    [
      r.id,
      r.title,
      r.client?.householdName ?? "Advisor-originated",
      r.advisor.name,
      r.advisor.branch,
      PRODUCT_AREA_LABELS[r.productArea],
      TYPE_LABELS[r.requestType],
      CHANNEL_LABELS[r.channel],
      PRIORITY_LABELS[r.priority],
      STATUS_LABELS[r.status],
      AUTOMATION_LABELS[r.automationStatus],
      r.owner?.name ?? "",
      r.externalIssue ? `${r.externalIssue.key}${r.externalIssue.isSample ? " (sample)" : ""}` : "",
      r.tags.join("; "),
      r.submittedAt,
      r.updatedAt,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n");
}
