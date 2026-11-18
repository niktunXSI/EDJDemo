"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiFetch, errorMessage } from "@/lib/api-client";

interface QueueResponse {
  created: boolean;
  job: { revision: number; eventId: string };
  webhookEnabled: boolean;
  delivery: { id: string; status: string; attempt?: number; statusCode?: number | null; error?: string | null } | null;
}

export function QueueButton({
  requestId,
  mode,
  destination,
  size = "default",
  className,
}: {
  requestId: string;
  mode: "queue" | "requeue" | "active";
  destination: "mock" | "external";
  size?: "default" | "sm";
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function queue() {
    setBusy(true);
    try {
      const result = await apiFetch<QueueResponse>(`/api/requests/${requestId}/queue`, { body: { force: mode === "requeue" } });
      if (!result.created) {
        toast.info("Already queued", {
          description: `Revision ${result.job.revision} is already queued (event ${result.job.eventId.slice(0, 16)}…). No duplicate event was created.`,
        });
      } else if (!result.webhookEnabled || !result.delivery) {
        toast.success(`Queued revision ${result.job.revision} for automation`, {
          description: "Webhook delivery is disabled. The request is discoverable through the Agent API.",
        });
      } else if (result.delivery.status === "delivered") {
        toast.success(`Queued revision ${result.job.revision} for automation`, {
          description:
            destination === "mock"
              ? "Event accepted by the built-in mock receiver (simulated; not sent externally). Awaiting automation pickup."
              : `Webhook delivered (HTTP ${result.delivery.statusCode}). Delivery confirms receipt only, not processing.`,
        });
      } else if (result.delivery.status === "pending") {
        toast.warning(`Queued revision ${result.job.revision}; webhook attempt failed`, {
          description: `${result.delivery.error ?? "The receiver did not accept the event."} A retry is scheduled automatically.`,
        });
      } else {
        toast.error(`Queued revision ${result.job.revision}; webhook delivery failed`, {
          description: `${result.delivery.error ?? "The receiver rejected the event."} Retry from Integrations. The request remains discoverable via the API.`,
        });
      }
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (mode === "active") {
    return (
      <Button size={size} variant="outline" disabled className={className}>
        <Bot /> In automation
      </Button>
    );
  }
  return (
    <Button size={size} onClick={queue} disabled={busy} variant={mode === "requeue" ? "outline" : "default"} className={className}>
      {busy ? <Loader2 className="animate-spin" /> : mode === "requeue" ? <RotateCw /> : <Bot />}
      {mode === "requeue" ? "Re-queue for automation" : "Queue for automation"}
    </Button>
  );
}
