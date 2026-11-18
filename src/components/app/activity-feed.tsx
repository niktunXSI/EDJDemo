import Link from "next/link";
import {
  ArrowRightLeft,
  Bot,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Flag,
  MessageSquare,
  PencilLine,
  Send,
  UserRoundCheck,
  Inbox,
  RefreshCw,
} from "lucide-react";
import type { ActivityEvent } from "@/lib/server/requests";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SampleTag } from "./badges";

function iconFor(type: string) {
  if (type === "request.submitted") return { Icon: Inbox, tone: "bg-[#f6ecd3] text-[#6a4c0f]" };
  if (type === "status.changed") return { Icon: ArrowRightLeft, tone: "bg-[#e7edf4] text-[#2b4766]" };
  if (type === "priority.changed") return { Icon: Flag, tone: "bg-[#fbeee2] text-[#97410c]" };
  if (type.startsWith("request.assigned") || type === "request.unassigned") return { Icon: UserRoundCheck, tone: "bg-[#e1ede6] text-[#1d4a37]" };
  if (type === "note.added") return { Icon: MessageSquare, tone: "bg-[#eeece8] text-[#4a4e52]" };
  if (type === "request.updated") return { Icon: PencilLine, tone: "bg-[#eeece8] text-[#4a4e52]" };
  if (type === "automation.completed") return { Icon: CircleCheck, tone: "bg-[#e1efe6] text-[#1f5c3b]" };
  if (type === "automation.failed" || type === "webhook.failed") return { Icon: CircleAlert, tone: "bg-[#fbe9e7] text-[#9b1c13]" };
  if (type === "webhook.attempt_failed") return { Icon: RefreshCw, tone: "bg-[#fbeee2] text-[#97410c]" };
  if (type.startsWith("webhook.")) return { Icon: Send, tone: "bg-[#e7edf4] text-[#1f4f84]" };
  if (type === "external_reference.attached") return { Icon: ExternalLink, tone: "bg-[#e8e6f5] text-[#3b347f]" };
  if (type.startsWith("automation.")) return { Icon: Bot, tone: "bg-[#f6ecd3] text-[#6a4c0f]" };
  return { Icon: PencilLine, tone: "bg-muted text-muted-foreground" };
}

export function ActivityFeed({ events, showRequest = false, now }: { events: ActivityEvent[]; showRequest?: boolean; now: Date }) {
  return (
    <ol className="relative">
      {events.map((event, index) => {
        const { Icon, tone } = iconFor(event.eventType);
        const reason = typeof event.details.reason === "string" ? event.details.reason : null;
        const excerpt = typeof event.details.excerpt === "string" ? event.details.excerpt : null;
        return (
          <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
            {index < events.length - 1 && <span aria-hidden className="absolute left-[13px] top-7 h-[calc(100%-20px)] w-px bg-border" />}
            <span className={cn("relative z-10 mt-0.5 flex size-[27px] shrink-0 items-center justify-center rounded-full", tone)}>
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-snug text-foreground">
                {event.summary}
                {event.isSample && <SampleTag className="ml-1.5 align-middle" />}
              </p>
              {showRequest && event.requestId && (
                <Link href={`/requests/${event.requestId}`} className="mt-0.5 block truncate text-[12.5px] text-[#1d4a37] hover:underline">
                  {event.requestId} · {event.requestTitle}
                </Link>
              )}
              {reason && <p className="mt-1 text-[12.5px] text-muted-foreground">Reason: {reason}</p>}
              {excerpt && !showRequest && <p className="mt-1 line-clamp-2 text-[12.5px] italic text-muted-foreground">“{excerpt}”</p>}
              <p className="mt-0.5 text-[11.5px] text-muted-foreground" title={formatDateTime(event.createdAt)}>
                {event.actorName} · {formatRelative(event.createdAt, now)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
