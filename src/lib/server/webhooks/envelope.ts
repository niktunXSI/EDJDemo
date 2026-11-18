import { randomUUID } from "node:crypto";
import {
  AUTOMATION_LABELS,
  CHANNEL_LABELS,
  PRIORITY_LABELS,
  PRODUCT_AREA_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_SCHEMA_VERSION,
} from "@/lib/domain";
import type { RequestDetail } from "../requests";

export const EVENT_SOURCE = "edward-jones.client-product-insights";

export function newEventId() {
  return `evt_${randomUUID().replace(/-/g, "")}`;
}

export function newCorrelationId() {
  return `cor_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function tenureYears(since: string, now: Date) {
  return Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / (365.25 * 24 * 3600 * 1000)));
}

/**
 * Structured snapshot sent to automation. Client identity (household name, primary contact,
 * city) is excluded unless the integration setting explicitly includes it.
 */
export function requestSnapshot(request: RequestDetail, includeClientIdentity: boolean, now = new Date()) {
  const client = request.clientDetail;
  return {
    id: request.id,
    revision: request.revision,
    title: request.title,
    type: { code: request.requestType, label: TYPE_LABELS[request.requestType] },
    productArea: { code: request.productArea, label: PRODUCT_AREA_LABELS[request.productArea] },
    channel: { code: request.channel, label: CHANNEL_LABELS[request.channel] },
    priority: { code: request.priority, label: PRIORITY_LABELS[request.priority] },
    businessStatus: { code: request.status, label: STATUS_LABELS[request.status] },
    automationStatus: { code: request.automationStatus, label: AUTOMATION_LABELS[request.automationStatus] },
    tags: request.tags,
    content: {
      originalFeedback: request.originalFeedback,
      problemStatement: request.problemStatement,
      requestedOutcome: request.requestedOutcome,
      currentWorkaround: request.currentWorkaround,
      businessImpact: request.businessImpact,
      expectedBenefit: request.expectedBenefit,
    },
    submittedBy: {
      advisorId: request.advisorDetail.id,
      name: request.advisorDetail.name,
      branch: request.advisorDetail.branch,
      region: request.advisorDetail.region,
    },
    owner: request.ownerDetail
      ? { id: request.ownerDetail.id, name: request.ownerDetail.name, role: request.ownerDetail.role, team: request.ownerDetail.team }
      : null,
    clientContext: client
      ? {
          segment: client.segment,
          region: client.region,
          relationshipTenureYears: tenureYears(client.relationshipSince, now),
          householdMembers: client.householdMembers,
          preferredChannel: client.preferredChannel,
          ...(includeClientIdentity
            ? { clientId: client.id, householdName: client.householdName, primaryContact: client.primaryContact, city: client.city, state: client.state }
            : {}),
        }
      : null,
    relatedRequests: request.related.map((r) => ({ id: r.id, title: r.title, status: r.status, priority: r.priority })),
    submittedAt: request.submittedAt,
    updatedAt: request.updatedAt,
  };
}

export interface EventLinks {
  baseUrl: string;
}

export function buildQueuedEvent(options: {
  request: RequestDetail;
  eventId: string;
  correlationId: string;
  jobId: string;
  includeClientIdentity: boolean;
  baseUrl: string;
  occurredAt?: Date;
  environment: string;
}) {
  const { request, baseUrl } = options;
  const occurredAt = options.occurredAt ?? new Date();
  const apiBase = `${baseUrl}/api/v1/requests/${request.id}`;
  return {
    id: options.eventId,
    type: WEBHOOK_EVENT_TYPES.requestQueued,
    schemaVersion: WEBHOOK_SCHEMA_VERSION,
    occurredAt: occurredAt.toISOString(),
    source: EVENT_SOURCE,
    environment: options.environment,
    correlationId: options.correlationId,
    data: {
      requestId: request.id,
      revision: request.revision,
      automationJobId: options.jobId,
      request: requestSnapshot(request, options.includeClientIdentity, occurredAt),
      links: {
        detailUrl: `${baseUrl}/requests/${request.id}`,
        apiUrl: apiBase,
        activityUrl: `${apiBase}/activity`,
        claimUrl: `${apiBase}/claim`,
        resultUrl: `${apiBase}/result`,
      },
      instructions:
        "Claim the request through the Agent API before processing. Webhook delivery does not mean the request has been processed.",
    },
  };
}

export function buildTestEvent(options: { eventId: string; baseUrl: string; environment: string; actor: string }) {
  return {
    id: options.eventId,
    type: WEBHOOK_EVENT_TYPES.test,
    schemaVersion: WEBHOOK_SCHEMA_VERSION,
    occurredAt: new Date().toISOString(),
    source: EVENT_SOURCE,
    environment: options.environment,
    correlationId: newCorrelationId(),
    data: {
      message: "Test event from Client Product Insights. No action is required.",
      triggeredBy: options.actor,
      links: { apiUrl: `${options.baseUrl}/api/v1/requests?automationStatus=queued` },
    },
  };
}
