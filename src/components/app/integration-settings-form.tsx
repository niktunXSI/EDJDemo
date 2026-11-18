"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Globe, Loader2, PlayCircle, Send, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiClientError, apiFetch, errorMessage } from "@/lib/api-client";
import type { PublicIntegrationSettings } from "@/lib/server/settings";
import { cn } from "@/lib/utils";

function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div>
        <Label htmlFor={id} className="text-[13.5px] font-medium">
          {label}
        </Label>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

export function IntegrationSettingsForm({
  settings,
  mockReceiverUrl,
  canAdmin,
}: {
  settings: PublicIntegrationSettings;
  mockReceiverUrl: string;
  canAdmin: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [destination, setDestination] = useState(settings.destination);
  const [url, setUrl] = useState(settings.url);
  const [autoQueue, setAutoQueue] = useState(settings.autoQueue);
  const [includeClient, setIncludeClient] = useState(settings.includeClientIdentity);
  const [mockFailure, setMockFailure] = useState(settings.mockFailureMode);
  const [bearer, setBearer] = useState("");
  const [clearBearer, setClearBearer] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [bearerError, setBearerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [dispatching, setDispatching] = useState(false);

  const urlManaged = settings.urlSource === "environment";
  const bearerManaged = settings.bearerSource === "environment";
  const destinationManaged = settings.destinationSource === "environment";
  const autoQueueManaged = settings.autoQueueSource === "environment";
  const locked = !canAdmin;
  const dirty =
    enabled !== settings.enabled ||
    destination !== settings.destination ||
    (!urlManaged && url !== settings.url) ||
    bearer.trim() !== "" ||
    clearBearer ||
    autoQueue !== settings.autoQueue ||
    includeClient !== settings.includeClientIdentity ||
    mockFailure !== settings.mockFailureMode;

  async function save() {
    setSaving(true);
    setUrlError(null);
    setBearerError(null);
    try {
      const body: Record<string, unknown> = {
        enabled,
        includeClientIdentity: includeClient,
        mockFailureMode: mockFailure,
      };
      if (!destinationManaged) body.destination = destination;
      if (!autoQueueManaged) body.autoQueue = autoQueue;
      if (!urlManaged) body.url = url.trim();
      if (!bearerManaged && (bearer.trim() || clearBearer)) body.bearerToken = clearBearer ? "" : bearer.trim();
      await apiFetch("/api/integrations/settings", { method: "PATCH", body });
      toast.success("Integration settings saved");
      setBearer("");
      setClearBearer(false);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError && (error.code.includes("url") || error.fields.some((f) => f.path === "url"))) {
        setUrlError(error.fields.find((f) => f.path === "url")?.message ?? error.message);
      }
      if (error instanceof ApiClientError) {
        const field = error.fields.find((f) => f.path === "bearerToken");
        if (field) setBearerError(field.message);
      }
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      const result = await apiFetch<{ status: string; statusCode: number | null; error: string | null; eventId: string }>("/api/integrations/test", {
        body: {},
      });
      const mock = settings.destination === "mock";
      if (result.status === "delivered") {
        toast.success(mock ? "Test event accepted by the mock receiver" : `Test event delivered (HTTP ${result.statusCode})`, {
          description: mock ? "Simulated delivery; nothing left this application." : `Event ${result.eventId}`,
        });
      } else if (result.status === "pending") {
        toast.warning("Test event attempt failed; retry scheduled", { description: result.error ?? undefined });
      } else {
        toast.error("Test event failed", { description: result.error ?? undefined });
      }
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setTesting(false);
    }
  }

  async function dispatchNow() {
    setDispatching(true);
    try {
      const r = await apiFetch<{ processed: number; delivered: number; rescheduled: number; failed: number; leasesReleased: number; paused: boolean }>(
        "/api/integrations/dispatch",
        { body: {} },
      );
      if (r.paused) toast.info("The connection is disabled; deliveries are paused.");
      else if (r.processed === 0) toast.info("No deliveries are due right now.", { description: r.leasesReleased ? `${r.leasesReleased} expired lease(s) returned to the queue.` : undefined });
      else toast.success(`Processed ${r.processed} delivery attempt${r.processed === 1 ? "" : "s"}`, { description: `${r.delivered} delivered · ${r.rescheduled} rescheduled · ${r.failed} failed` });
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDispatching(false);
    }
  }

  return (
    <div className="space-y-5">
      {locked && (
        <p className="flex gap-2 rounded-md border border-[#e5d3a4] bg-[#fbf5e6] px-3 py-2.5 text-[12.5px] leading-relaxed text-[#6a4c0f]">
          <ShieldAlert className="mt-px size-4 shrink-0" />
          Only administrators can change integration settings. Cursor team admins qualify automatically; the app owner can add emails to
          the APP_ADMIN_EMAILS app secret. You can still send test events and process deliveries.
        </p>
      )}
      <fieldset disabled={locked} className="space-y-5 disabled:opacity-70">
      <ToggleRow
        id="enabled"
        label="Webhook connection enabled"
        description="When disabled, nothing is sent. Queued requests remain discoverable through the Agent API."
        checked={enabled}
        onChange={setEnabled}
        disabled={locked}
      />

      <fieldset className="space-y-2 border-t border-border/70 pt-4" disabled={destinationManaged || locked}>
        <legend className="text-[13.5px] font-medium">
          Destination{destinationManaged && <span className="ml-2 text-[12px] font-normal text-muted-foreground">External (set by WEBHOOK_URL)</span>}
        </legend>
        <div className="grid gap-2 md:grid-cols-2">
          {(
            [
              { value: "mock", icon: FlaskConical, title: "Built-in mock receiver", body: "Verifies signatures and records events inside this app. Clearly labeled as simulated." },
              { value: "external", icon: Globe, title: "External webhook URL", body: "POSTs signed events to your automation endpoint over HTTPS." },
            ] as const
          ).map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer gap-3 rounded-md border p-3 transition-colors",
                destination === option.value ? "border-[#1d4a37] bg-[#f1f6f3] ring-1 ring-[#1d4a37]" : "border-border hover:bg-muted/50",
              )}
            >
              <input type="radio" name="destination" value={option.value} checked={destination === option.value} onChange={() => setDestination(option.value)} className="sr-only" />
              <option.icon className={cn("mt-0.5 size-4 shrink-0", destination === option.value ? "text-[#1d4a37]" : "text-muted-foreground")} />
              <span>
                <span className="block text-[13px] font-semibold">{option.title}</span>
                <span className="text-[12px] leading-relaxed text-muted-foreground">{option.body}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="webhook-url" className="text-[13.5px] font-medium">
          Webhook URL
        </Label>
        {urlManaged ? (
          <p className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">
            Set by the <code className="font-mono">WEBHOOK_URL</code> environment variable: <span className="font-mono text-foreground">{settings.displayUrl}</span>
          </p>
        ) : (
          <Input
            id="webhook-url"
            value={url}
            onChange={(e) => (setUrl(e.target.value), setUrlError(null))}
            placeholder="https://automation.example.com/hooks/client-product-insights"
            aria-invalid={Boolean(urlError)}
            className="font-mono text-[13px]"
          />
        )}
        {urlError ? (
          <p className="text-[12px] font-medium text-[#9b1c13]">{urlError}</p>
        ) : (
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Must be publicly reachable over HTTPS from this deployment. To exercise a real HTTP round trip locally, use{" "}
            <button type="button" className="font-mono text-[#1d4a37] underline-offset-2 hover:underline" onClick={() => setUrl(mockReceiverUrl)}>
              {mockReceiverUrl}
            </button>
            .
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="webhook-bearer" className="text-[13.5px] font-medium">
          Destination authorization token <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        {bearerManaged ? (
          <p className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">
            Set by the <code className="font-mono">WEBHOOK_BEARER_TOKEN</code> environment variable: <span className="font-mono">{settings.maskedBearer}</span>
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="webhook-bearer"
              type="password"
              autoComplete="off"
              value={bearer}
              onChange={(e) => (setBearer(e.target.value), setClearBearer(false), setBearerError(null))}
              aria-invalid={Boolean(bearerError)}
              placeholder={settings.maskedBearer ? `Current: ${settings.maskedBearer} (type to replace)` : "Paste the token your webhook endpoint requires"}
              className="min-w-0 flex-1 font-mono text-[13px]"
            />
            {settings.maskedBearer && (
              <Button type="button" variant="ghost" size="sm" onClick={() => (setBearer(""), setClearBearer(true))} disabled={clearBearer}>
                {clearBearer ? "Will be removed" : "Remove"}
              </Button>
            )}
          </div>
        )}
        {bearerError && <p className="text-[12px] font-medium text-[#9b1c13]">{bearerError}</p>}
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Paste just the key (a leading &ldquo;Bearer&rdquo; is removed automatically). Sent as <code className="font-mono">Authorization: Bearer …</code> to external destinations that require their own key, such as an
          automation webhook trigger. Stored server-side and never shown again.
        </p>
      </div>

      <div className="divide-y divide-border/70 border-t border-border/70">
        <ToggleRow
          id="auto-queue"
          label="Queue new submissions automatically"
          description={
            autoQueueManaged
              ? "Set by the AUTO_QUEUE_NEW_REQUESTS environment variable."
              : "Off by default so demos are predictable. When on, every new request is queued and an event is sent on submission."
          }
          checked={autoQueue}
          onChange={setAutoQueue}
          disabled={autoQueueManaged || locked}
        />
        <ToggleRow
          id="include-client"
          label="Include client identity in webhook payloads"
          description="Off by default. Payloads carry segment, region, and tenure only. Turn on to add household name and primary contact."
          checked={includeClient}
          onChange={setIncludeClient}
          disabled={locked}
        />
        <ToggleRow
          id="mock-failure"
          label="Simulate mock receiver outage"
          description="The mock receiver responds HTTP 503 so you can demonstrate retries, backoff, and manual retry."
          checked={mockFailure}
          onChange={setMockFailure}
          disabled={locked}
        />
      </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-4">
        <Button onClick={save} disabled={!dirty || saving || locked}>
          {saving && <Loader2 className="animate-spin" />}
          Save settings
        </Button>
        <Button variant="outline" onClick={sendTest} disabled={testing || dirty || !settings.enabled} title={dirty ? "Save changes first" : undefined}>
          {testing ? <Loader2 className="animate-spin" /> : <Send />}
          Send test event
        </Button>
        <Button variant="ghost" onClick={dispatchNow} disabled={dispatching}>
          {dispatching ? <Loader2 className="animate-spin" /> : <PlayCircle />}
          Process due deliveries now
        </Button>
        {dirty && <span className="text-[12px] text-[#6a4c0f]">Unsaved changes</span>}
      </div>
    </div>
  );
}
