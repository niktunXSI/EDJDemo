import "server-only";
import { sql } from "./db";

const iso = (v: unknown) => new Date(v as string).toISOString();

export interface ClientSummary {
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
  advisor: { id: string; name: string; branch: string };
  requestCount: number;
  openRequestCount: number;
}

export interface AdvisorSummary {
  id: string;
  name: string;
  title: string;
  branch: string;
  city: string;
  state: string;
  region: string;
  email: string;
  joinedYear: number;
  clientCount: number;
  submissionCount: number;
  openSubmissionCount: number;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  team: string;
}

function mapClient(r: Record<string, unknown>): ClientSummary {
  return {
    id: r.id as string,
    householdName: r.household_name as string,
    primaryContact: r.primary_contact as string,
    city: r.city as string,
    state: r.state as string,
    region: r.region as string,
    segment: r.segment as string,
    relationshipSince: iso(r.relationship_since).slice(0, 10),
    householdMembers: Number(r.household_members),
    preferredChannel: r.preferred_channel as string,
    advisor: { id: r.advisor_id as string, name: r.advisor_name as string, branch: r.advisor_branch as string },
    requestCount: Number(r.request_count ?? 0),
    openRequestCount: Number(r.open_count ?? 0),
  };
}

const CLIENT_SELECT = `
  select c.*, a.name as advisor_name, a.branch as advisor_branch,
    (select count(*)::int from requests r where r.client_id = c.id) as request_count,
    (select count(*)::int from requests r where r.client_id = c.id and r.status not in ('delivered','declined')) as open_count
  from clients c join advisors a on a.id = c.advisor_id`;

export async function listClients(): Promise<ClientSummary[]> {
  return (await sql<Record<string, unknown>>(`${CLIENT_SELECT} order by c.household_name`)).map(mapClient);
}

export async function getClient(id: string): Promise<ClientSummary | null> {
  const [row] = await sql<Record<string, unknown>>(`${CLIENT_SELECT} where c.id = $1`, [id.toUpperCase()]);
  return row ? mapClient(row) : null;
}

const ADVISOR_SELECT = `
  select a.*,
    (select count(*)::int from clients c where c.advisor_id = a.id) as client_count,
    (select count(*)::int from requests r where r.advisor_id = a.id) as submission_count,
    (select count(*)::int from requests r where r.advisor_id = a.id and r.status not in ('delivered','declined')) as open_count
  from advisors a`;

function mapAdvisor(r: Record<string, unknown>): AdvisorSummary {
  return {
    id: r.id as string,
    name: r.name as string,
    title: r.title as string,
    branch: r.branch as string,
    city: r.city as string,
    state: r.state as string,
    region: r.region as string,
    email: r.email as string,
    joinedYear: Number(r.joined_year),
    clientCount: Number(r.client_count ?? 0),
    submissionCount: Number(r.submission_count ?? 0),
    openSubmissionCount: Number(r.open_count ?? 0),
  };
}

export async function listAdvisors(): Promise<AdvisorSummary[]> {
  return (await sql<Record<string, unknown>>(`${ADVISOR_SELECT} order by a.name`)).map(mapAdvisor);
}

export async function getAdvisor(id: string): Promise<AdvisorSummary | null> {
  const [row] = await sql<Record<string, unknown>>(`${ADVISOR_SELECT} where a.id = $1`, [id.toUpperCase()]);
  return row ? mapAdvisor(row) : null;
}

export async function listClientsForAdvisor(advisorId: string): Promise<ClientSummary[]> {
  return (await sql<Record<string, unknown>>(`${CLIENT_SELECT} where c.advisor_id = $1 order by c.household_name`, [advisorId])).map(
    mapClient,
  );
}

export async function listTeam(): Promise<TeamMember[]> {
  return sql<TeamMember>("select id, name, role, team from team_members order by name");
}

/** Lightweight option lists for forms and filters. */
export async function formOptions() {
  const [clients, advisors, team] = await Promise.all([
    sql<{ id: string; household_name: string; advisor_id: string; segment: string; city: string; state: string }>(
      "select id, household_name, advisor_id, segment, city, state from clients order by household_name",
    ),
    sql<{ id: string; name: string; branch: string }>("select id, name, branch from advisors order by name"),
    listTeam(),
  ]);
  return {
    clients: clients.map((c) => ({
      id: c.id,
      householdName: c.household_name,
      advisorId: c.advisor_id,
      segment: c.segment,
      location: `${c.city}, ${c.state}`,
    })),
    advisors: advisors.map((a) => ({ id: a.id, name: a.name, branch: a.branch })),
    team,
  };
}
export type FormOptions = Awaited<ReturnType<typeof formOptions>>;
