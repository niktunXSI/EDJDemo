import Link from "next/link";
import { headers } from "next/headers";
import { AlertTriangle, CheckCircle2, CircleSlash, FlaskConical, Globe, KeyRound, ShieldCheck } from "lucide-react";
import { AutoDispatch } from "@/components/app/auto-dispatch";
import { MockTag } from "@/components/app/badges";
import { CodeBlock } from "@/components/app/code-block";
import { CredentialField } from "@/components/app/credential-field";
import { DeliveryLog } from "@/components/app/delivery-log";
import { IntegrationSettingsForm } from "@/components/app/integration-settings-form";
import { MockInbox } from "@/components/app/mock-inbox";
import { PageHeader, Panel } from "@/components/app/page-header";
import { formatDateTime } from "@/lib/format";
import { curlExamples, NODE_VERIFY_SNIPPET, PYTHON_VERIFY_SNIPPET, SIGNATURE_HEADERS } from "@/lib/integration-docs";
import { automationOverview } from "@/lib/server/automation";
import { config } from "@/lib/server/config";
import { sql } from "@/lib/server/db";
import { getRequest } from "@/lib/server/requests";
import { getSettings, toPublicSettings } from "@/lib/server/settings";
import { buildQueuedEvent } from "@/lib/server/webhooks/envelope";
import { deliveryStats, getDelivery, listDeliveries } from "@/lib/server/webhooks/dispatcher";
import { listMockEvents } from "@/lib/server/webhooks/mock-receiver";
import { cn } from "@/lib/utils";

export const metadata = { title: "Integrations" };

const TABS = [
  { id: "connection", label: "Connection" },
  { id: "deliveries", label: "Delivery log" },
  { id: "mock", label: "Mock receiver" },
  { id: "api", label: "API guide" },
] as const;
type Tab = (typeof TABS)[number]["id"];

async function baseUrl() {
  if (config.appBaseUrl) return config.appBaseUrl;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:4317";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto.split(",")[0]}://${host.split(",")[0]}`;
}

function Stat({ label, value, tone, detail }: { label: string; value: React.ReactNode; tone?: string; detail?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-[20px] font-semibold tabular leading-tight", tone)}>{value}</p>
      {detail && <p className="mt-0.5 text-[11.5px] text-muted-foreground">{detail}</p>}
    </div>
  );
}

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const requested = (await searchParams).tab;
  const tab: Tab = TABS.some((t) => t.id === requested) ? (requested as Tab) : "connection";
  const [settings, stats, automation, url] = await Promise.all([getSettings(), deliveryStats(), automationOverview(), baseUrl()]);
  const publicSettings = toPublicSettings(settings);
  const now = new Date();

  return (
    <>
      <AutoDispatch active={stats.pending > 0} />
      <PageHeader
        title="Integrations"
        description="The boundary between Client Product Insights and external automation. Queued requests are announced by a signed outbound webhook and processed through the authenticated Agent API. This application never creates issues in Jira or any other tracker."
        breadcrumbs={[{ label: "Overview", href: "/" }, { label: "Integrations" }]}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Stat
            label="Webhook connection"
            value={
              settings.enabled ? (
                <span className="inline-flex items-center gap-1.5 text-[#1f5c3b]">
                  <CheckCircle2 className="size-4" /> Enabled
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <CircleSlash className="size-4" /> Disabled
                </span>
              )
            }
            detail={
              settings.destination === "mock" ? (
                <span className="inline-flex items-center gap-1">
                  <MockTag /> Built-in mock receiver
                </span>
              ) : (
                <span className="font-mono">{publicSettings.displayUrl}</span>
              )
            }
          />
          <Stat label="Automation queue" value={`${automation.queued} / ${automation.processing}`} detail="queued / processing" />
          <Stat label="Retrying" value={stats.pending} tone={stats.pending ? "text-[#6a4c0f]" : undefined} detail="deliveries awaiting a retry" />
          <Stat label="Failed deliveries" value={stats.failed} tone={stats.failed ? "text-[#9b1c13]" : undefined} detail="need a manual retry" />
          <Stat label="Accepted" value={`${stats.delivered} / ${stats.mock_delivered}`} detail="external / mock (simulated)" />
        </div>
      </PageHeader>

      <nav aria-label="Integration sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.id === "connection" ? "/integrations" : `/integrations?tab=${t.id}`}
            aria-current={tab === t.id ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13.5px] font-medium transition-colors",
              tab === t.id ? "border-[#1d4a37] text-[#1d4a37]" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "connection" && <ConnectionTab url={url} />}
      {tab === "deliveries" && (
        <Panel title="Webhook deliveries" description="Durable outbox. Retries back off exponentially and reuse the original event ID. Errors are sanitized." bodyClassName="p-0">
          <DeliveryLog deliveries={await listDeliveries({ limit: 50 })} now={now.toISOString()} />
        </Panel>
      )}
      {tab === "mock" && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Panel title="Mock receiver inbox" description="Events received and verified by the built-in mock receiver" bodyClassName="p-0">
            <MockInbox events={await listMockEvents(30)} />
          </Panel>
          <Panel title="About the mock receiver">
            <div className="space-y-3 text-[13px] leading-relaxed text-muted-foreground">
              <p>
                The mock receiver lets you demonstrate the full integration without an external endpoint. It verifies each signature with the current signing secret
                and responds like a real webhook endpoint.
              </p>
              <p>
                With <strong className="text-foreground">Built-in mock receiver</strong> selected, events are delivered in-process. Deliveries are labeled{" "}
                <MockTag /> and are never counted as external deliveries.
              </p>
              <p>
                For a real HTTP round trip on a local machine, choose <strong className="text-foreground">External webhook URL</strong> and enter{" "}
                <code className="break-all font-mono text-[12px] text-foreground">{url}/api/mock-receiver</code>.
              </p>
              <p>
                Turn on <strong className="text-foreground">Simulate mock receiver outage</strong> under Connection to demonstrate failures, automatic retries, and manual retry.
                Current mode: <strong className="text-foreground">{settings.mockFailureMode ? "responding 503" : "accepting events (202)"}</strong>.
              </p>
            </div>
          </Panel>
        </div>
      )}
      {tab === "api" && <ApiTab url={url} />}
    </>
  );
}

async function ConnectionTab({ url }: { url: string }) {
  const settings = await getSettings();
  const p = toPublicSettings(settings);
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <Panel title="Outbound webhook" description={`Last changed ${formatDateTime(p.updatedAt)}${p.updatedBy ? ` by ${p.updatedBy}` : ""}`}>
        <IntegrationSettingsForm settings={p} mockReceiverUrl={`${url}/api/mock-receiver`} />
      </Panel>
      <div className="flex flex-col gap-6">
        <Panel title="Credentials" description="Stored server-side and never sent to the browser unless you choose Reveal.">
          <div className="divide-y divide-border/70">
            <CredentialField
              which="secret"
              label="Webhook signing secret"
              description="HMAC-SHA256 key used to sign every outbound event. Share it with the receiving workflow so it can verify X-CPI-Signature."
              masked={p.maskedSecret}
              managedBy={p.secretSource === "environment" ? "WEBHOOK_SIGNING_SECRET" : null}
              rotateWarning="Events signed after rotation will fail verification until the receiving workflow is updated with the new secret."
            />
            <CredentialField
              which="apiKey"
              label="Agent API key"
              description="Bearer token for /api/v1. Give it to the external automation so it can list, claim, and update requests."
              masked={p.maskedApiKey}
              managedBy={p.apiKeySource === "environment" ? `AGENT_API_KEYS (${p.envApiKeyCount} key${p.envApiKeyCount === 1 ? "" : "s"})` : null}
              rotateWarning="The current key stops working immediately. Any automation using it will receive 401 until it is updated."
            />
          </div>
        </Panel>
        <Panel title="How the boundary works">
          <ol className="space-y-3 text-[13px] leading-relaxed">
            {[
              ["Queue", "A person selects Queue for Automation. The queued state, an automation job, and an outbox row are written in one transaction."],
              ["Notify", "The outbox sends a signed POST to the webhook URL, retrying with backoff. Delivery proves receipt only."],
              ["Claim", "The workflow claims the request through the Agent API. Leases prevent two workers from processing it at once."],
              ["Report", "The workflow posts progress, attaches the issue key and URL it created, and records a result or failure."],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#1d4a37] text-[11.5px] font-semibold text-white">{i + 1}</span>
                <span>
                  <strong className="font-semibold">{title}.</strong> <span className="text-muted-foreground">{body}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 flex gap-2 rounded-md border border-[#e5d3a4] bg-[#fbf5e6] px-3 py-2 text-[12px] leading-relaxed text-[#6a4c0f]">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            External automation must reach this app over HTTPS. A deployment on localhost or behind sign-in cannot be called by a hosted workflow.
          </p>
        </Panel>
      </div>
    </div>
  );
}

async function ApiTab({ url }: { url: string }) {
  const [latest] = await sql<{ id: string }>(
    "select id from webhook_deliveries where event_type = 'feedback.request.queued' order by created_at desc limit 1",
  );
  let sample: unknown = null;
  let sampleSource = "Generated example";
  if (latest) {
    sample = (await getDelivery(latest.id))?.payload ?? null;
    sampleSource = "Most recent real payload";
  }
  if (!sample) {
    const request = await getRequest("CPI-1006");
    if (request) {
      sample = buildQueuedEvent({
        request,
        eventId: "evt_6b1f0d2c9a8e4f7b8c3d2e1f0a9b8c7d",
        correlationId: "cor_2c41a9e07b6d5f3e8a1b",
        jobId: "job_8d3e2f1a0b9c8d7e6f5a",
        includeClientIdentity: false,
        baseUrl: url,
        environment: "demo",
      });
    }
  }
  const [queued] = await sql<{ id: string }>(
    "select id from requests where automation_status = 'queued' order by automation_updated_at desc nulls last limit 1",
  );
  const exampleId = queued?.id ?? "CPI-1033";

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Panel title="Agent API quick start" description={`Base URL ${url}/api/v1 · JSON over HTTPS · Bearer authentication`}>
          <CodeBlock title="curl" code={curlExamples(url, exampleId)} />
        </Panel>
        <Panel title="Webhook event envelope" description={`${sampleSource}. Client identity is excluded unless the integration setting includes it.`}>
          <CodeBlock title="feedback.request.queued (schemaVersion 1.0)" code={JSON.stringify(sample, null, 2)} />
        </Panel>
        <Panel title="Verifying signatures" description="Reject any request whose signature does not match or whose timestamp is more than five minutes old.">
          <div className="space-y-3">
            <CodeBlock title="Request headers" code={SIGNATURE_HEADERS} />
            <CodeBlock title="Node.js" code={NODE_VERIFY_SNIPPET} />
            <CodeBlock title="Python" code={PYTHON_VERIFY_SNIPPET} />
          </div>
        </Panel>
      </div>
      <div className="flex flex-col gap-6">
        <Panel title="Endpoints">
          <ul className="space-y-2.5 font-mono text-[12px]">
            {[
              ["GET", "/requests", "List with filters and pagination"],
              ["GET", "/requests/{id}", "Latest revision, automation state"],
              ["GET", "/requests/{id}/activity", "Activity history"],
              ["POST", "/requests/{id}/claim", "Atomic claim with lease"],
              ["POST", "/automation/claim-next", "Claim oldest queued request"],
              ["POST", "/requests/{id}/automation-status", "Progress + lease renewal"],
              ["PUT", "/requests/{id}/external-reference", "Attach issue key and URL"],
              ["POST", "/requests/{id}/result", "Record completion or failure"],
              ["POST", "/webhooks/dispatch", "Worker/cron delivery tick"],
            ].map(([method, path, desc]) => (
              <li key={path}>
                <span className={cn("mr-2 inline-block w-11 rounded-[3px] px-1 text-center text-[10.5px] font-semibold", method === "GET" ? "bg-[#e7edf4] text-[#2b4766]" : method === "PUT" ? "bg-[#e8e6f5] text-[#3b347f]" : "bg-[#e1ede6] text-[#1d4a37]")}>
                  {method}
                </span>
                <span className="text-foreground">{path}</span>
                <p className="ml-[52px] font-sans text-[11.5px] text-muted-foreground">{desc}</p>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Filters for GET /requests">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            <code className="font-mono text-foreground">q</code>, <code className="font-mono text-foreground">status</code>,{" "}
            <code className="font-mono text-foreground">priority</code>, <code className="font-mono text-foreground">productArea</code>,{" "}
            <code className="font-mono text-foreground">requestType</code>, <code className="font-mono text-foreground">automationStatus</code>,{" "}
            <code className="font-mono text-foreground">clientId</code>, <code className="font-mono text-foreground">advisorId</code>,{" "}
            <code className="font-mono text-foreground">updatedSince</code> (ISO 8601), <code className="font-mono text-foreground">sort</code>,{" "}
            <code className="font-mono text-foreground">dir</code>, <code className="font-mono text-foreground">page</code>,{" "}
            <code className="font-mono text-foreground">pageSize</code> (max 100). Multi-value filters accept commas: <code className="font-mono text-foreground">priority=critical,high</code>.
          </p>
        </Panel>
        <Panel title="Errors and guarantees">
          <ul className="space-y-2 text-[12.5px] leading-relaxed text-muted-foreground">
            <li className="flex gap-2">
              <KeyRound className="mt-0.5 size-3.5 shrink-0 text-foreground" />
              <span>
                <strong className="text-foreground">401</strong> missing or invalid key · <strong className="text-foreground">404</strong> unknown request ·{" "}
                <strong className="text-foreground">422</strong> validation failed (field list in <code className="font-mono">error.details.fields</code>)
              </span>
            </li>
            <li className="flex gap-2">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-foreground" />
              <span>
                <strong className="text-foreground">409</strong> codes: <code className="font-mono">already_claimed</code>, <code className="font-mono">not_queued</code>,{" "}
                <code className="font-mono">stale_claim</code> (lease expired, reclaimed, or superseded), <code className="font-mono">already_finalized</code>.
              </span>
            </li>
            <li className="flex gap-2">
              <FlaskConical className="mt-0.5 size-3.5 shrink-0 text-foreground" />
              <span>Results and external references are idempotent per claim token. Replaying the same result returns 200 with replayed: true.</span>
            </li>
            <li className="flex gap-2">
              <Globe className="mt-0.5 size-3.5 shrink-0 text-foreground" />
              <span>Expired leases return the request to the queue automatically. Claims made with an old token are rejected.</span>
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
