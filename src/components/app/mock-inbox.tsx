"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleX, Inbox, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { formatDateTime, formatTime } from "@/lib/format";
import type { MockEvent } from "@/lib/server/webhooks/mock-receiver";
import { CodeBlock } from "./code-block";
import { EmptyState } from "./page-header";

export function MockInbox({ events }: { events: MockEvent[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<MockEvent | null>(null);
  const [clearing, setClearing] = useState(false);

  async function clear() {
    setClearing(true);
    try {
      await apiFetch("/api/integrations/mock-events", { method: "DELETE" });
      toast.success("Mock receiver inbox cleared");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setClearing(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-border/70 px-5 py-2.5">
        <p className="text-[12.5px] text-muted-foreground">{events.length} most recent event{events.length === 1 ? "" : "s"} received</p>
        <Button size="sm" variant="ghost" onClick={clear} disabled={clearing || events.length === 0}>
          <Trash2 /> Clear inbox
        </Button>
      </div>
      {events.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-5" />}
          title="The mock receiver has not received anything yet"
          description="Select the built-in mock receiver as the destination, then queue a request or send a test event."
        />
      ) : (
        <ul className="divide-y divide-border/70">
          {events.map((e) => (
            <li key={e.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                {e.signatureValid ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-[#1f5c3b]" aria-label="Signature valid" />
                ) : (
                  <CircleX className="mt-0.5 size-4 shrink-0 text-[#9b1c13]" aria-label="Signature invalid" />
                )}
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">
                    {e.eventType ?? "Unknown event"}
                    {e.requestId && (
                      <Link href={`/requests/${e.requestId}`} className="ml-2 font-mono text-[12px] text-[#1d4a37] hover:underline">
                        {e.requestId}
                      </Link>
                    )}
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{e.eventId}</p>
                  {!e.signatureValid && <p className="text-[12px] text-[#9b1c13]">{e.signatureError}</p>}
                </div>
              </div>
              <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
                <span className={e.responseStatus < 300 ? "text-[#1f5c3b]" : "text-[#9b1c13]"}>Responded {e.responseStatus}</span>
                <span title={formatDateTime(e.receivedAt)}>{formatTime(e.receivedAt)}</span>
                <Button size="xs" variant="outline" onClick={() => setSelected(e)}>
                  View payload
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Received by mock receiver</DialogTitle>
            <DialogDescription>
              {selected?.signatureValid ? "Signature verified with the current signing secret." : `Signature rejected: ${selected?.signatureError}`} Received{" "}
              {selected ? formatDateTime(selected.receivedAt) : ""}.
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <CodeBlock title="Headers (signature redacted)" code={JSON.stringify(selected.headers, null, 2)} />
              <CodeBlock title="Body" code={JSON.stringify(selected.body, null, 2)} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
