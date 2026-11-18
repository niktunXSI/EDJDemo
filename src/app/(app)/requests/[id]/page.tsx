import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowUpRight, Building2, ExternalLink, Info, Mail, UsersRound } from "lucide-react";
import { ActivityFeed } from "@/components/app/activity-feed";
import { AutoDispatch } from "@/components/app/auto-dispatch";
import {
  AutomationBadge,
  DeliveryStatusBadge,
  JobStatusText,
  MockTag,
  PriorityIndicator,
  SampleTag,
  StatusBadge,
} from "@/components/app/badges";
import { EditRequestSheet } from "@/components/app/edit-request-sheet";
import { NoteComposer } from "@/components/app/note-composer";
import { FieldRow, PageHeader, Panel } from "@/components/app/page-header";
import { QueueButton } from "@/components/app/queue-button";
import { RequestControls } from "@/components/app/request-controls";
import { CHANNEL_LABELS, PRODUCT_AREA_LABELS, TYPE_LABELS } from "@/lib/domain";
import { formatDate, formatDateTime, formatRelative, tenureLabel } from "@/lib/format";
import { listJobs } from "@/lib/server/automation";
import { formOptions } from "@/lib/server/directory";
import { sql } from "@/lib/server/db";
import { getActivity, getNotes, getRequest } from "@/lib/server/requests";
import { getDemoSession } from "@/lib/server/session";
import { getSettings } from "@/lib/server/settings";
import { listDeliveries } from "@/lib/server/webhooks/dispatcher";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: id.toUpperCase() };
}

function TextBlock({ label, children, empty }: { label: string; children: string; empty: string }) {
  return (
    <div>
      <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</h3>
      {children.trim() ? (
        <p className="mt-1.5 whitespace-pre-line text-[14px] leading-relaxed text-foreground">{children}</p>
      ) : (
        <p className="mt-1.5 text-[13px] italic text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const request = await getRequest(id);
  if (!request) notFound();
  const now = new Date();

  const [notes, activity, jobs, deliveries, options, settings, session, siblings] = await Promise.all([
    getNotes(request.id),
    getActivity(request.id),
    listJobs(request.id),
    listDeliveries({ requestId: request.id, limit: 5 }),
    formOptions(),
    getSettings(),
    getDemoSession(),
    request.client
      ? sql<{ count: number }>("select count(*)::int as count from requests where client_id = $1 and id <> $2", [request.client.id, request.id])
      : Promise.resolve([{ count: 0 }]),
  ]);

  const latestJob = jobs.find((j) => j.status !== "superseded") ?? jobs[0] ?? null;
  const activeJob = jobs.find((j) => j.status === "queued" || j.status === "processing") ?? null;
  const editedSinceQueued = latestJob !== null && latestJob.revision < request.revision;
  const queueMode: "queue" | "requeue" | "active" = activeJob
    ? activeJob.revision === request.revision
      ? "active"
      : "queue"
    : latestJob && latestJob.revision === request.revision
      ? "requeue"
      : "queue";
  const latestDelivery = deliveries[0] ?? null;

  return (
    <>
      <AutoDispatch active={latestDelivery?.status === "pending" || latestDelivery?.status === "sending" || request.automationStatus === "processing"} />
      <PageHeader
        breadcrumbs={[{ label: "Overview", href: "/" }, { label: "Request queue", href: "/requests" }, { label: request.id }]}
        eyebrow={
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
            <span className="font-mono font-medium text-foreground/80">{request.id}</span>
            <span aria-hidden>·</span>
            <span>{TYPE_LABELS[request.requestType]}</span>
            <span aria-hidden>·</span>
            <span>{PRODUCT_AREA_LABELS[request.productArea]}</span>
            <span aria-hidden>·</span>
            <span>Revision {request.revision}</span>
            {request.isSample && <SampleTag label="Seed data" />}
          </div>
        }
        title={request.title}
        actions={
          <>
            <EditRequestSheet
              request={{
                id: request.id,
                revision: request.revision,
                title: request.title,
                requestType: request.requestType,
                productArea: request.productArea,
                channel: request.channel,
                clientId: request.client?.id ?? null,
                advisorId: request.advisor.id,
                originalFeedback: request.originalFeedback,
                problemStatement: request.problemStatement,
                requestedOutcome: request.requestedOutcome,
                currentWorkaround: request.currentWorkaround,
                businessImpact: request.businessImpact,
                expectedBenefit: request.expectedBenefit,
                tags: request.tags,
              }}
              options={{ clients: options.clients, advisors: options.advisors }}
            />
            <QueueButton requestId={request.id} mode={queueMode} destination={settings.destination} />
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
          <span className="flex items-center gap-2">
            <span className="text-muted-foreground">Priority</span>
            <PriorityIndicator priority={request.priority} />
          </span>
          <span className="flex items-center gap-2">
            <span className="text-muted-foreground">Status</span>
            <StatusBadge status={request.status} />
          </span>
          <span className="flex items-center gap-2">
            <span className="text-muted-foreground">Automation</span>
            <AutomationBadge status={request.automationStatus} />
          </span>
          {request.externalIssue && (
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground">External reference</span>
              <span className="font-mono text-[12.5px] font-medium">{request.externalIssue.key}</span>
              {request.externalIssue.isSample && <SampleTag />}
            </span>
          )}
          <span className="text-muted-foreground">
            Submitted {formatDate(request.submittedAt)} · Updated {formatRelative(request.updatedAt, now)}
          </span>
        </div>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Original client feedback">
            <blockquote className="border-l-[3px] border-[#c9a14a] bg-[#fbf8ef] py-3 pl-4 pr-3 font-serif text-[16px] leading-relaxed text-[#2a2f2c]">
              “{request.originalFeedback}”
            </blockquote>
            <p className="mt-2.5 text-[12.5px] text-muted-foreground">
              Relayed by {request.advisor.name}, {request.advisor.branch}
              {request.client ? ` · ${request.client.householdName}` : " · advisor-originated"} · {formatDateTime(request.submittedAt)}
            </p>
          </Panel>

          <Panel title="Problem and requested enhancement">
            <div className="space-y-5">
              <TextBlock label="Problem statement" empty="No problem statement yet. Edit the request to add one.">
                {request.problemStatement}
              </TextBlock>
              <TextBlock label="Requested enhancement" empty="Not provided.">
                {request.requestedOutcome}
              </TextBlock>
              <TextBlock label="Current workaround" empty="No workaround recorded.">
                {request.currentWorkaround}
              </TextBlock>
            </div>
          </Panel>

          <Panel title="Business impact">
            <div className="grid gap-5 md:grid-cols-2">
              <TextBlock label="Business impact" empty="Not provided.">
                {request.businessImpact}
              </TextBlock>
              <TextBlock label="Expected benefit" empty="No expected benefit recorded.">
                {request.expectedBenefit}
              </TextBlock>
            </div>
          </Panel>

          <Panel title="Internal notes" description={`${notes.length} note${notes.length === 1 ? "" : "s"} · visible to internal teams only`}>
            <NoteComposer requestId={request.id} authorName={session.persona.name} />
            {notes.length > 0 && (
              <ul className="mt-5 space-y-4 border-t border-border/70 pt-4">
                {notes.map((note) => (
                  <li key={note.id} className="text-[13.5px]">
                    <p className="flex items-baseline gap-2">
                      <span className="font-semibold text-foreground">{note.authorName}</span>
                      <span className="text-[12px] text-muted-foreground" title={formatDateTime(note.createdAt)}>
                        {formatRelative(note.createdAt, now)}
                      </span>
                    </p>
                    <p className="mt-1 whitespace-pre-line leading-relaxed text-foreground/90">{note.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Activity timeline" description="Every change, note, and automation event for this request">
            <ActivityFeed events={activity} now={now} />
          </Panel>
        </div>

        <aside className="flex flex-col gap-6">
          <Panel title="Triage">
            <RequestControls
              requestId={request.id}
              revision={request.revision}
              status={request.status}
              priority={request.priority}
              ownerId={request.owner?.id ?? null}
              team={options.team}
            />
            <dl className="mt-4 border-t border-border/70 pt-3">
              <FieldRow label="Product area">{PRODUCT_AREA_LABELS[request.productArea]}</FieldRow>
              <FieldRow label="Category">{TYPE_LABELS[request.requestType]}</FieldRow>
              <FieldRow label="Channel">{CHANNEL_LABELS[request.channel]}</FieldRow>
              <FieldRow label="Owner team">{request.ownerDetail ? request.ownerDetail.team : <span className="text-muted-foreground">Unassigned</span>}</FieldRow>
              <FieldRow label="Tags">
                {request.tags.length ? (
                  <span className="flex flex-wrap gap-1">
                    {request.tags.map((tag) => (
                      <Link key={tag} href={`/requests?q=${encodeURIComponent(tag)}`} className="rounded-[4px] bg-muted px-1.5 py-0.5 text-[12px] hover:bg-accent">
                        #{tag}
                      </Link>
                    ))}
                  </span>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </FieldRow>
            </dl>
          </Panel>

          <Panel
            id="automation"
            title="Automation"
            description="Status reported by the external workflow"
            actions={
              <Link href="/integrations?tab=deliveries" className="text-[12px] text-[#1d4a37] hover:underline">
                Delivery log
              </Link>
            }
          >
            <div className="flex items-center justify-between">
              <AutomationBadge status={request.automationStatus} className="text-[13px]" />
              {request.automationUpdatedAt && <span className="text-[12px] text-muted-foreground">{formatRelative(request.automationUpdatedAt, now)}</span>}
            </div>
            {request.automationSummary && <p className="mt-2 text-[13px] leading-relaxed text-foreground/90">{request.automationSummary}</p>}

            {editedSinceQueued && (
              <p className="mt-3 flex gap-2 rounded-md border border-[#e5d3a4] bg-[#fbf5e6] px-3 py-2 text-[12px] leading-relaxed text-[#6a4c0f]">
                <AlertTriangle className="mt-px size-3.5 shrink-0" />
                Edited since it was queued (revision {latestJob!.revision} → {request.revision}). Queue again to send the latest content.
              </p>
            )}

            {request.externalIssue && (
              <div className="mt-3 rounded-md border border-border bg-[#fbf9f3] px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">External reference</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  {request.externalIssue.url && !request.externalIssue.isSample ? (
                    <a href={request.externalIssue.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[13px] font-semibold text-[#1d4a37] hover:underline">
                      {request.externalIssue.key} <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    <span className="font-mono text-[13px] font-semibold">{request.externalIssue.key}</span>
                  )}
                  <span className="text-[11.5px] uppercase text-muted-foreground">{request.externalIssue.system ?? "external"}</span>
                </div>
                {request.externalIssue.isSample && (
                  <p className="mt-1 text-[11.5px] text-muted-foreground">Sample record from seed data. Not linked to a live issue tracker.</p>
                )}
              </div>
            )}

            {latestJob ? (
              <dl className="mt-3 border-t border-border/70 pt-2">
                <FieldRow label="Job">
                  <span className="flex items-center gap-2">
                    <JobStatusText status={latestJob.status} />
                    {latestJob.isSample && <SampleTag />}
                  </span>
                </FieldRow>
                <FieldRow label="Revision">{latestJob.revision}</FieldRow>
                <FieldRow label="Event ID">
                  <span className="break-all font-mono text-[11.5px]">{latestJob.eventId}</span>
                </FieldRow>
                <FieldRow label="Queued">
                  {formatDateTime(latestJob.createdAt)} by {latestJob.queuedBy}
                </FieldRow>
                {latestJob.claimedBy && <FieldRow label="Claimed by">{latestJob.claimedBy}</FieldRow>}
                {latestJob.leaseExpiresAt && latestJob.status === "processing" && (
                  <FieldRow label="Lease until">{formatDateTime(latestJob.leaseExpiresAt)}</FieldRow>
                )}
                {latestJob.statusMessage && latestJob.status === "processing" && <FieldRow label="Last update">{latestJob.statusMessage}</FieldRow>}
              </dl>
            ) : (
              <p className="mt-3 flex gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
                <Info className="mt-px size-3.5 shrink-0" />
                Not yet sent to automation. Queueing records an automation event and notifies the configured webhook.
              </p>
            )}

            {latestDelivery && (
              <div className="mt-3 border-t border-border/70 pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Latest webhook delivery</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <DeliveryStatusBadge status={latestDelivery.status} mock={latestDelivery.destination === "mock"} />
                  {latestDelivery.destination === "mock" && <MockTag />}
                  <span className="text-[12px] text-muted-foreground">
                    Attempt {latestDelivery.attemptCount} of {latestDelivery.maxAttempts}
                    {latestDelivery.lastStatusCode ? ` · HTTP ${latestDelivery.lastStatusCode}` : ""}
                  </span>
                </div>
                {latestDelivery.lastError && latestDelivery.status !== "delivered" && (
                  <p className="mt-1.5 text-[12px] text-[#9b1c13]">{latestDelivery.lastError}</p>
                )}
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                  {latestDelivery.destination === "mock"
                    ? "Simulated delivery to the built-in mock receiver. Nothing was sent outside this application."
                    : "Successful delivery confirms receipt by the endpoint, not that automation has processed the request."}
                </p>
              </div>
            )}

            <div className="mt-4">
              <QueueButton requestId={request.id} mode={queueMode} destination={settings.destination} size="sm" className="w-full" />
            </div>
          </Panel>

          <Panel title="Client & household">
            {request.clientDetail ? (
              <>
                <Link href={`/clients/${request.clientDetail.id}`} className="group flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#e1ede6] text-[#1d4a37]">
                    <UsersRound className="size-4" />
                  </span>
                  <span>
                    <span className="flex items-center gap-1 font-semibold text-foreground group-hover:underline underline-offset-4">
                      {request.clientDetail.householdName} <ArrowUpRight className="size-3.5 text-muted-foreground" />
                    </span>
                    <span className="text-[12.5px] text-muted-foreground">
                      {request.clientDetail.segment} · {request.clientDetail.id}
                    </span>
                  </span>
                </Link>
                <dl className="mt-3">
                  <FieldRow label="Primary contact">{request.clientDetail.primaryContact}</FieldRow>
                  <FieldRow label="Location">
                    {request.clientDetail.city}, {request.clientDetail.state} · {request.clientDetail.region}
                  </FieldRow>
                  <FieldRow label="Tenure">
                    {tenureLabel(request.clientDetail.relationshipSince, now)} (since {request.clientDetail.relationshipSince.slice(0, 4)})
                  </FieldRow>
                  <FieldRow label="Household">{request.clientDetail.householdMembers} member{request.clientDetail.householdMembers === 1 ? "" : "s"}</FieldRow>
                  <FieldRow label="Prefers">{request.clientDetail.preferredChannel}</FieldRow>
                </dl>
                {siblings[0].count > 0 && (
                  <Link href={`/requests?clientId=${request.clientDetail.id}`} className="mt-2 inline-block text-[12.5px] text-[#1d4a37] hover:underline">
                    {siblings[0].count} other request{siblings[0].count === 1 ? "" : "s"} from this household
                  </Link>
                )}
              </>
            ) : (
              <p className="text-[13px] text-muted-foreground">Advisor- or operations-originated. No household is linked to this request.</p>
            )}
          </Panel>

          <Panel title="Submitting advisor">
            <Link href={`/advisors/${request.advisorDetail.id}`} className="group flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#f6ecd3] text-[#6a4c0f]">
                <Building2 className="size-4" />
              </span>
              <span>
                <span className="flex items-center gap-1 font-semibold text-foreground group-hover:underline underline-offset-4">
                  {request.advisorDetail.name} <ArrowUpRight className="size-3.5 text-muted-foreground" />
                </span>
                <span className="text-[12.5px] text-muted-foreground">
                  {request.advisorDetail.branch} · {request.advisorDetail.city}, {request.advisorDetail.state}
                </span>
              </span>
            </Link>
            <p className="mt-2.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <Mail className="size-3.5" /> {request.advisorDetail.email}
            </p>
          </Panel>

          <Panel title="Related requests">
            {request.related.length ? (
              <ul className="space-y-2.5">
                {request.related.map((r) => (
                  <li key={r.id}>
                    <Link href={`/requests/${r.id}`} className="group block">
                      <span className="text-[13px] font-medium text-foreground group-hover:underline underline-offset-4">
                        <span className="mr-1.5 font-mono text-[11.5px] text-muted-foreground">{r.id}</span>
                        {r.title}
                      </span>
                      <span className="mt-1 flex items-center gap-2">
                        <StatusBadge status={r.status} />
                        <PriorityIndicator priority={r.priority} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">No related requests linked.</p>
            )}
          </Panel>
        </aside>
      </div>
    </>
  );
}
