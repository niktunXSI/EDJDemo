import {
  AUTOMATION_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type AutomationStatus,
  type DeliveryStatus,
  type JobStatus,
  type Priority,
  type RequestStatus,
} from "@/lib/domain";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<RequestStatus, string> = {
  new: "bg-[#f6ecd3] text-[#6a4c0f] ring-[#e5d3a4]",
  under_review: "bg-[#e7edf4] text-[#2b4766] ring-[#cbd7e5]",
  planned: "bg-[#e1ede6] text-[#1d4a37] ring-[#c2d9cb]",
  in_progress: "bg-[#e8e6f5] text-[#3b347f] ring-[#d0cceb]",
  delivered: "bg-[#1d4a37] text-[#f7f4ea] ring-[#1d4a37]",
  declined: "bg-[#eeece8] text-[#55585c] ring-[#dad6cf]",
};

export function StatusBadge({ status, className }: { status: RequestStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-[4px] px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        STATUS_STYLES[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

const AUTOMATION_DOT: Record<AutomationStatus, string> = {
  not_queued: "bg-transparent ring-1 ring-[#9a9ea3]",
  queued: "bg-[#b38b3d]",
  processing: "bg-[#2f6fb3] animate-pulse",
  completed: "bg-[#2a7a4f]",
  failed: "bg-[#b42318]",
};

const AUTOMATION_TEXT: Record<AutomationStatus, string> = {
  not_queued: "text-muted-foreground",
  queued: "text-[#6a4c0f]",
  processing: "text-[#1f4f84]",
  completed: "text-[#1f5c3b]",
  failed: "text-[#9b1c13]",
};

export function AutomationBadge({ status, className }: { status: AutomationStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium", AUTOMATION_TEXT[status], className)}>
      <span aria-hidden className={cn("size-2 rounded-full", AUTOMATION_DOT[status])} />
      {AUTOMATION_LABELS[status]}
    </span>
  );
}

const PRIORITY_COLORS: Record<Priority, string> = {
  critical: "#b42318",
  high: "#b54708",
  medium: "#9a7425",
  low: "#7a7f84",
};
const PRIORITY_LEVEL: Record<Priority, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export function PriorityIndicator({ priority, className, showLabel = true }: { priority: Priority; className?: string; showLabel?: boolean }) {
  const level = PRIORITY_LEVEL[priority];
  const color = PRIORITY_COLORS[priority];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium", className)} style={{ color }}>
      <span aria-hidden className="flex h-3 items-end gap-[2px]">
        {[1, 2, 3, 4].map((bar) => (
          <span
            key={bar}
            className="w-[3px] rounded-[1px]"
            style={{ height: `${bar * 3}px`, backgroundColor: bar <= level ? color : "#d9d4c7" }}
          />
        ))}
      </span>
      {showLabel ? PRIORITY_LABELS[priority] : <span className="sr-only">{PRIORITY_LABELS[priority]}</span>}
    </span>
  );
}

const DELIVERY_STYLES: Record<DeliveryStatus, string> = {
  pending: "bg-[#f6ecd3] text-[#6a4c0f] ring-[#e5d3a4]",
  sending: "bg-[#e7edf4] text-[#1f4f84] ring-[#cbd7e5]",
  delivered: "bg-[#e1efe6] text-[#1f5c3b] ring-[#c0dccb]",
  failed: "bg-[#fbe9e7] text-[#9b1c13] ring-[#f2c7c2]",
};

export function DeliveryStatusBadge({ status, mock }: { status: DeliveryStatus; mock: boolean }) {
  const label =
    status === "delivered"
      ? mock
        ? "Accepted by mock"
        : "Delivered"
      : status === "pending"
        ? "Retry scheduled"
        : status === "sending"
          ? "Sending"
          : "Failed";
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-[4px] px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        DELIVERY_STYLES[status],
      )}
    >
      {label}
    </span>
  );
}

export function MockTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[3px] border border-dashed border-[#b38b3d] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-[#7a5a17]",
        className,
      )}
    >
      Mock
    </span>
  );
}

export function SampleTag({ className, label = "Sample" }: { className?: string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[3px] bg-muted px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      {label}
    </span>
  );
}

const JOB_LABELS: Record<JobStatus, string> = {
  queued: "Queued",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  superseded: "Superseded",
};

export function JobStatusText({ status }: { status: JobStatus }) {
  if (status === "superseded") return <span className="text-xs font-medium text-muted-foreground">{JOB_LABELS[status]}</span>;
  return <AutomationBadge status={status} />;
}

export const STATUS_BAR_COLORS: Record<RequestStatus, string> = {
  new: "#c9a14a",
  under_review: "#6f8fb3",
  planned: "#5e9a7a",
  in_progress: "#6c63b5",
  delivered: "#1d4a37",
  declined: "#b9b4ab",
};
