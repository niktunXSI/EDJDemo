import Link from "next/link";
import { ArrowUpRight, ListChecks, MessageSquarePlus } from "lucide-react";
import { ActivityFeed } from "@/components/app/activity-feed";
import { AutomationBadge, PriorityIndicator, STATUS_BAR_COLORS, StatusBadge } from "@/components/app/badges";
import { EmptyState, PageHeader, Panel } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { PRODUCT_AREA_LABELS, REQUEST_STATUSES, STATUS_LABELS } from "@/lib/domain";
import { formatDate, formatRelative } from "@/lib/format";
import { getDashboard } from "@/lib/server/dashboard";
import { getRecentActivity, listRequests } from "@/lib/server/requests";
import { listQuerySchema } from "@/lib/validation";

export const metadata = { title: "Overview" };

function Kpi({
  label,
  value,
  detail,
  href,
  accent,
}: {
  label: string;
  value: number;
  detail: React.ReactNode;
  href: string;
  accent?: string;
}) {
  return (
    <Link
      href={href}
      className="group relative flex flex-col rounded-md border border-border bg-card px-5 py-4 transition-colors hover:border-[#c9bfa6]"
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] rounded-t-md" style={{ backgroundColor: accent ?? "#1d4a37" }} />
      <span className="flex items-center justify-between text-[12.5px] font-medium text-muted-foreground">
        {label}
        <ArrowUpRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
      <span className="mt-2 font-serif text-[34px] font-semibold leading-none tabular text-[#18231d]">{value.toLocaleString("en-US")}</span>
      <span className="mt-2 text-[12.5px] text-muted-foreground">{detail}</span>
    </Link>
  );
}

export default async function OverviewPage() {
  const now = new Date();
  const [dashboard, recent, activity] = await Promise.all([
    getDashboard(),
    listRequests(listQuerySchema.parse({ sort: "submitted", dir: "desc", pageSize: 6 })),
    getRecentActivity(10),
  ]);
  const { totals, byArea, statusTotals, weeks } = dashboard;
  const maxArea = Math.max(1, ...byArea.map((a) => a.total));
  const maxWeek = Math.max(1, ...weeks.map((w) => w.count));
  const trend = totals.submitted_30d - totals.submitted_prev_30d;

  return (
    <>
      <PageHeader
        title="Client feedback overview"
        description="How client and advisor feedback is flowing into the product backlog, where demand is concentrated, and what needs attention."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/requests">
                <ListChecks /> Open queue
              </Link>
            </Button>
            <Button asChild>
              <Link href="/requests/new">
                <MessageSquarePlus /> Submit feedback
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Total requests"
          value={totals.total}
          href="/requests"
          detail={
            <>
              {totals.open_count} open · {totals.submitted_30d} in the last 30 days
              {trend !== 0 && (
                <span className={trend > 0 ? "text-[#97410c]" : "text-[#1f5c3b]"}>
                  {" "}
                  ({trend > 0 ? "+" : ""}
                  {trend} vs. prior)
                </span>
              )}
            </>
          }
        />
        <Kpi
          label="New, awaiting review"
          value={totals.new_count}
          href="/requests?status=new"
          accent="#c9a14a"
          detail={`${totals.unassigned_open} open request${totals.unassigned_open === 1 ? "" : "s"} without an owner`}
        />
        <Kpi
          label="High priority, open"
          value={totals.high_open}
          href="/requests?priority=critical,high&status=new,under_review,planned,in_progress"
          accent="#b54708"
          detail={`${totals.critical_open} critical`}
        />
        <Kpi
          label="With automation activity"
          value={totals.automation}
          href="/requests?automationStatus=queued,processing,completed,failed"
          accent="#2f6fb3"
          detail={
            <>
              {totals.automation_active} in flight
              {totals.automation_failed > 0 && <span className="text-[#9b1c13]"> · {totals.automation_failed} failed</span>}
            </>
          }
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Requests by product area and status"
          description="Each bar shows every request for the product area, segmented by business status. Select a row to filter the queue."
        >
          <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5">
            {REQUEST_STATUSES.map((status) => (
              <span key={status} className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <span aria-hidden className="size-2.5 rounded-[2px]" style={{ backgroundColor: STATUS_BAR_COLORS[status] }} />
                {STATUS_LABELS[status]}
              </span>
            ))}
          </div>
          <ul className="space-y-1">
            {byArea.map((row) => (
              <li key={row.area}>
                <Link
                  href={`/requests?productArea=${row.area}`}
                  className="grid grid-cols-[minmax(130px,190px)_1fr_36px] items-center gap-3 rounded px-2 py-1.5 hover:bg-muted/60"
                >
                  <span className="truncate text-[13px] font-medium text-foreground">{PRODUCT_AREA_LABELS[row.area]}</span>
                  <span className="flex h-[14px] overflow-hidden rounded-[3px] bg-muted" style={{ width: `${Math.max(4, (row.total / maxArea) * 100)}%` }}>
                    {REQUEST_STATUSES.map((status) =>
                      row.counts[status] > 0 ? (
                        <span
                          key={status}
                          title={`${STATUS_LABELS[status]}: ${row.counts[status]}`}
                          style={{ width: `${(row.counts[status] / Math.max(row.total, 1)) * 100}%`, backgroundColor: STATUS_BAR_COLORS[status] }}
                          className="h-full border-r border-white/70 last:border-r-0"
                        />
                      ) : null,
                    )}
                  </span>
                  <span className="text-right text-[13px] font-semibold tabular text-foreground">{row.total}</span>
                </Link>
                <span className="sr-only">
                  {REQUEST_STATUSES.filter((s) => row.counts[s] > 0)
                    .map((s) => `${STATUS_LABELS[s]} ${row.counts[s]}`)
                    .join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title="Status distribution" description="All requests by business status">
            <dl className="space-y-2.5">
              {REQUEST_STATUSES.map((status) => {
                const count = statusTotals[status];
                const pct = totals.total ? Math.round((count / totals.total) * 100) : 0;
                return (
                  <div key={status}>
                    <div className="flex items-center justify-between text-[13px]">
                      <dt>
                        <Link href={`/requests?status=${status}`} className="hover:underline underline-offset-4">
                          {STATUS_LABELS[status]}
                        </Link>
                      </dt>
                      <dd className="tabular text-muted-foreground">
                        <span className="font-semibold text-foreground">{count}</span> · {pct}%
                      </dd>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: STATUS_BAR_COLORS[status] }} />
                    </div>
                  </div>
                );
              })}
            </dl>
          </Panel>

          <Panel title="Submissions per week" description="Last 12 weeks, by submission date">
            <div className="flex h-24 items-end gap-1.5" role="img" aria-label={`Weekly submissions: ${weeks.map((w) => w.count).join(", ")}`}>
              {weeks.map((week, index) => (
                <div key={week.week} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] tabular text-muted-foreground">{week.count || ""}</span>
                  <div
                    className="w-full rounded-t-[2px]"
                    style={{
                      height: `${Math.max(3, (week.count / maxWeek) * 64)}px`,
                      backgroundColor: index === weeks.length - 1 ? "#c9a14a" : "#5e9a7a",
                      opacity: week.count ? 1 : 0.35,
                    }}
                    title={`Week of ${formatDate(week.week)}: ${week.count}`}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
              <span>{formatDate(weeks[0]?.week)}</span>
              <span>This week</span>
            </div>
          </Panel>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Recent submissions"
          bodyClassName="p-0"
          actions={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/requests">View all</Link>
            </Button>
          }
        >
          {recent.items.length === 0 ? (
            <EmptyState title="No requests yet" description="Submitted feedback will appear here." />
          ) : (
            <ul className="divide-y divide-border/70">
              {recent.items.map((item) => (
                <li key={item.id}>
                  <Link href={`/requests/${item.id}`} className="flex flex-col gap-1.5 px-5 py-3 hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-foreground">
                        <span className="mr-2 font-mono text-[12px] text-muted-foreground">{item.id}</span>
                        {item.title}
                      </p>
                      <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
                        {item.client?.householdName ?? "Advisor-originated"} · {item.advisor.name} · {PRODUCT_AREA_LABELS[item.productArea]}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <PriorityIndicator priority={item.priority} />
                      <StatusBadge status={item.status} />
                      <AutomationBadge status={item.automationStatus} className="hidden md:inline-flex" />
                      <span className="w-20 text-right text-[12px] text-muted-foreground">{formatRelative(item.submittedAt, now)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent activity" description="Across all requests">
          {activity.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ActivityFeed events={activity} showRequest now={now} />
          )}
        </Panel>
      </div>
    </>
  );
}
