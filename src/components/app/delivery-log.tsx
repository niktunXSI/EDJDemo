"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, RotateCw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { formatDateTime, formatTime } from "@/lib/format";
import type { DeliveryView } from "@/lib/server/webhooks/dispatcher";
import { CodeBlock } from "./code-block";
import { DeliveryStatusBadge, MockTag } from "./badges";
import { EmptyState } from "./page-header";

function RetryButton({ delivery }: { delivery: DeliveryView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await apiFetch<{ status: string; error: string | null; statusCode: number | null }>(
            `/api/integrations/deliveries/${delivery.id}/retry`,
            { body: {} },
          );
          if (r.status === "delivered") toast.success("Retry succeeded", { description: delivery.destination === "mock" ? "Accepted by the mock receiver (simulated)." : `HTTP ${r.statusCode}` });
          else toast.warning("Retry attempt did not succeed", { description: r.error ?? undefined });
          router.refresh();
        } catch (error) {
          toast.error(errorMessage(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <RotateCw />}
      {delivery.status === "pending" ? "Retry now" : "Retry"}
    </Button>
  );
}

function DetailsDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [result, setResult] = useState<{ id: string; detail?: DeliveryView; error?: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    apiFetch<DeliveryView>(`/api/integrations/deliveries/${id}`)
      .then((detail) => !cancelled && setResult({ id, detail }))
      .catch((e) => !cancelled && setResult({ id, error: errorMessage(e) }));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const current = result && result.id === id ? result : null;
  const detail = current?.detail ?? null;
  const error = current?.error ?? null;

  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Delivery {id}</DialogTitle>
          <DialogDescription>Payload exactly as signed and sent, with every attempt. The event ID is preserved across retries.</DialogDescription>
        </DialogHeader>
        {error && <p className="text-[13px] text-[#9b1c13]">{error}</p>}
        {!detail && !error && (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading delivery…
          </p>
        )}
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <DeliveryStatusBadge status={detail.status} mock={detail.destination === "mock"} />
              {detail.destination === "mock" && <MockTag />}
              <span className="font-mono text-muted-foreground">{detail.eventId}</span>
              <span className="text-muted-foreground">→ {detail.target}</span>
            </div>
            {detail.destination === "mock" && (
              <p className="rounded-md border border-dashed border-[#b38b3d] bg-[#fbf5e6] px-3 py-2 text-[12px] text-[#6a4c0f]">
                Simulated delivery to the built-in mock receiver. It was signed and verified exactly like a real delivery, but nothing was sent to an external system.
              </p>
            )}
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-[12.5px]">
                <thead className="bg-[#f7f4ec] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Attempt</th>
                    <th className="px-3 py-1.5 text-left font-medium">Started</th>
                    <th className="px-3 py-1.5 text-left font-medium">Outcome</th>
                    <th className="px-3 py-1.5 text-left font-medium">HTTP</th>
                    <th className="px-3 py-1.5 text-left font-medium">Duration</th>
                    <th className="px-3 py-1.5 text-left font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {(detail.attempts ?? []).length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-3 text-muted-foreground">
                        No attempts yet.
                      </td>
                    </tr>
                  )}
                  {(detail.attempts ?? []).map((a) => (
                    <tr key={a.attemptNumber}>
                      <td className="px-3 py-1.5 tabular">#{a.attemptNumber}</td>
                      <td className="px-3 py-1.5">{formatTime(a.startedAt)}</td>
                      <td className="px-3 py-1.5">{a.outcome.replace(/_/g, " ")}</td>
                      <td className="px-3 py-1.5 tabular">{a.statusCode ?? "—"}</td>
                      <td className="px-3 py-1.5 tabular">{a.durationMs} ms</td>
                      <td className="max-w-[260px] truncate px-3 py-1.5 text-muted-foreground" title={a.error ?? a.responseExcerpt ?? ""}>
                        {a.error ?? a.responseExcerpt ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CodeBlock title="Signed payload (application/json)" code={JSON.stringify(detail.payload, null, 2)} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function DeliveryLog({ deliveries, now }: { deliveries: DeliveryView[]; now: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const nowDate = new Date(now);
  if (!deliveries.length) {
    return (
      <EmptyState
        icon={<Send className="size-5" />}
        title="No deliveries yet"
        description="Queue a request for automation or send a test event. Every attempt, retry, and outcome will be recorded here."
      />
    );
  }
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-[12.5px]">
          <thead className="border-b border-border bg-[#f7f4ec] text-[12px] text-muted-foreground">
            <tr>
              <th className="py-2 pl-5 pr-3 text-left font-medium">Event</th>
              <th className="px-3 py-2 text-left font-medium">Request</th>
              <th className="px-3 py-2 text-left font-medium">Destination</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-left font-medium">Attempts</th>
              <th className="px-3 py-2 text-left font-medium">Last attempt</th>
              <th className="px-3 py-2 text-left font-medium">Error / next retry</th>
              <th className="py-2 pl-3 pr-5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {deliveries.map((d) => (
              <tr key={d.id} className="align-top hover:bg-[#faf8f2]">
                <td className="py-2.5 pl-5 pr-3">
                  <p className="font-medium text-foreground">{d.eventType}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{d.eventId}</p>
                </td>
                <td className="px-3 py-2.5">
                  {d.requestId ? (
                    <Link href={`/requests/${d.requestId}#automation`} className="font-mono hover:underline">
                      {d.requestId}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{d.isTest ? "Test event" : "—"}</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-1.5">
                    {d.destination === "mock" && <MockTag />}
                    <span className="max-w-[200px] truncate" title={d.target ?? ""}>
                      {d.target}
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <DeliveryStatusBadge status={d.status} mock={d.destination === "mock"} />
                </td>
                <td className="px-3 py-2.5 tabular">
                  {d.attemptCount} / {d.maxAttempts}
                  {d.lastStatusCode ? <span className="text-muted-foreground"> · HTTP {d.lastStatusCode}</span> : null}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground" title={formatDateTime(d.lastAttemptAt)}>
                  {d.lastAttemptAt ? formatTime(d.lastAttemptAt) : "—"}
                  <p className="text-[11px]">Created {formatDateTime(d.createdAt)}</p>
                </td>
                <td className="max-w-[260px] px-3 py-2.5">
                  {d.status === "pending" && d.nextAttemptAt && (
                    <p className="text-[#6a4c0f]">
                      Next retry {new Date(d.nextAttemptAt) > nowDate ? `at ${formatTime(d.nextAttemptAt)}` : "due now"}
                    </p>
                  )}
                  {d.lastError && d.status !== "delivered" && <p className="line-clamp-2 text-[#9b1c13]">{d.lastError}</p>}
                  {d.status === "delivered" && <p className="text-muted-foreground">{d.destination === "mock" ? "Simulated; not sent externally" : "Receipt confirmed; processing not implied"}</p>}
                </td>
                <td className="py-2.5 pl-3 pr-5">
                  <div className="flex justify-end gap-1.5">
                    <Button size="xs" variant="ghost" onClick={() => setOpenId(d.id)}>
                      Details
                    </Button>
                    {(d.status === "failed" || d.status === "pending") && <RetryButton delivery={d} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DetailsDialog id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
