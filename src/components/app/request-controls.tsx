"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PRIORITIES, PRIORITY_LABELS, REQUEST_STATUSES, STATUS_LABELS, type Priority, type RequestStatus } from "@/lib/domain";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { PriorityIndicator, StatusBadge } from "./badges";

interface Props {
  requestId: string;
  revision: number;
  status: RequestStatus;
  priority: Priority;
  ownerId: string | null;
  team: { id: string; name: string; role: string; team: string }[];
}

const UNASSIGNED = "__unassigned";

export function RequestControls({ requestId, revision, status, priority, ownerId, team }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState("");

  async function patch(field: string, body: Record<string, unknown>, success: string) {
    setSaving(field);
    try {
      await apiFetch(`/api/requests/${requestId}`, { method: "PATCH", body: { ...body, expectedRevision: revision } });
      toast.success(success);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      router.refresh();
    } finally {
      setSaving(null);
    }
  }

  function onStatus(value: string) {
    if (value === status) return;
    if (value === "declined") {
      setDeclineOpen(true);
      return;
    }
    void patch("status", { status: value }, `Status changed to ${STATUS_LABELS[value as RequestStatus]}`);
  }

  return (
    <div className="space-y-3.5">
      <div className="space-y-1.5">
        <Label htmlFor="status-select" className="text-[12px] font-medium text-muted-foreground">
          Business status
        </Label>
        <Select value={status} onValueChange={onStatus} disabled={saving !== null}>
          <SelectTrigger id="status-select" className="w-full bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REQUEST_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                <StatusBadge status={s} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="priority-select" className="text-[12px] font-medium text-muted-foreground">
          Priority
        </Label>
        <Select
          value={priority}
          onValueChange={(v) => v !== priority && patch("priority", { priority: v }, `Priority changed to ${PRIORITY_LABELS[v as Priority]}`)}
          disabled={saving !== null}
        >
          <SelectTrigger id="priority-select" className="w-full bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                <PriorityIndicator priority={p} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="owner-select" className="text-[12px] font-medium text-muted-foreground">
          Internal owner
        </Label>
        <Select
          value={ownerId ?? UNASSIGNED}
          onValueChange={(v) => {
            const next = v === UNASSIGNED ? null : v;
            if (next === ownerId) return;
            const name = team.find((m) => m.id === next)?.name;
            void patch("owner", { ownerId: next }, next ? `Assigned to ${name}` : "Owner removed");
          }}
          disabled={saving !== null}
        >
          <SelectTrigger id="owner-select" className="w-full bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED}>
              <span className="text-muted-foreground">Unassigned</span>
            </SelectItem>
            {team.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name} <span className="text-muted-foreground">· {m.role}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline {requestId}</DialogTitle>
            <DialogDescription>Record why this request will not be pursued. The reason appears in the activity timeline.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="decline-reason">Reason</Label>
            <Textarea id="decline-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Covered by the household reporting initiative (CPI-1001)." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={reason.trim().length < 5 || saving !== null}
              onClick={async () => {
                await patch("status", { status: "declined", statusReason: reason.trim() }, "Request declined");
                setDeclineOpen(false);
                setReason("");
              }}
            >
              Decline request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
