import "server-only";
import { listJobs, type JobView } from "./automation";
import type { RequestDetail, RequestListItem } from "./requests";
import { requestSnapshot } from "./webhooks/envelope";

export function listItemView(item: RequestListItem, baseUrl: string) {
  return {
    id: item.id,
    revision: item.revision,
    title: item.title,
    type: item.requestType,
    productArea: item.productArea,
    channel: item.channel,
    priority: item.priority,
    businessStatus: item.status,
    automationStatus: item.automationStatus,
    tags: item.tags,
    submittedBy: { advisorId: item.advisor.id, name: item.advisor.name, branch: item.advisor.branch },
    owner: item.owner,
    clientSegment: item.client?.segment ?? null,
    externalReference: item.externalIssue,
    submittedAt: item.submittedAt,
    updatedAt: item.updatedAt,
    isSample: item.isSample,
    links: { self: `${baseUrl}/api/v1/requests/${item.id}`, detailUrl: `${baseUrl}/requests/${item.id}` },
  };
}

function jobForApi(job: JobView) {
  return {
    id: job.id,
    revision: job.revision,
    eventId: job.eventId,
    correlationId: job.correlationId,
    status: job.status,
    claimedBy: job.claimedBy,
    leaseExpiresAt: job.leaseExpiresAt,
    claimCount: job.claimCount,
    statusMessage: job.statusMessage,
    resultSummary: job.resultSummary,
    errorMessage: job.errorMessage,
    isSample: job.isSample,
    createdAt: job.createdAt,
    claimedAt: job.claimedAt,
    completedAt: job.completedAt,
  };
}

export async function detailView(request: RequestDetail, baseUrl: string, includeClientIdentity: boolean) {
  const jobs = await listJobs(request.id);
  const current = jobs.find((j) => j.status === "queued" || j.status === "processing") ?? jobs[0] ?? null;
  const api = `${baseUrl}/api/v1/requests/${request.id}`;
  return {
    request: requestSnapshot(request, includeClientIdentity),
    automation: {
      status: request.automationStatus,
      summary: request.automationSummary,
      updatedAt: request.automationUpdatedAt,
      currentJob: current ? jobForApi(current) : null,
      history: jobs.map(jobForApi),
    },
    externalReference: request.externalIssue
      ? { ...request.externalIssue, note: request.externalIssue.isSample ? "Sample record from seed data; not a live issue." : undefined }
      : null,
    links: {
      self: api,
      detailUrl: `${baseUrl}/requests/${request.id}`,
      activity: `${api}/activity`,
      claim: `${api}/claim`,
      automationStatus: `${api}/automation-status`,
      externalReference: `${api}/external-reference`,
      result: `${api}/result`,
    },
  };
}
