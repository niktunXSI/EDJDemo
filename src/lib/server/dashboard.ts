import "server-only";
import { PRODUCT_AREAS, REQUEST_STATUSES, type ProductArea, type RequestStatus } from "@/lib/domain";
import { sql } from "./db";

export async function getDashboard() {
  const [totals] = await sql<{
    total: number;
    new_count: number;
    high_open: number;
    critical_open: number;
    automation: number;
    automation_active: number;
    automation_failed: number;
    open_count: number;
    submitted_30d: number;
    submitted_prev_30d: number;
    unassigned_open: number;
  }>(
    `select count(*)::int as total,
       count(*) filter (where status = 'new')::int as new_count,
       count(*) filter (where priority in ('critical','high') and status not in ('delivered','declined'))::int as high_open,
       count(*) filter (where priority = 'critical' and status not in ('delivered','declined'))::int as critical_open,
       count(*) filter (where automation_status <> 'not_queued')::int as automation,
       count(*) filter (where automation_status in ('queued','processing'))::int as automation_active,
       count(*) filter (where automation_status = 'failed')::int as automation_failed,
       count(*) filter (where status not in ('delivered','declined'))::int as open_count,
       count(*) filter (where submitted_at >= now() - interval '30 days')::int as submitted_30d,
       count(*) filter (where submitted_at < now() - interval '30 days' and submitted_at >= now() - interval '60 days')::int as submitted_prev_30d,
       count(*) filter (where owner_id is null and status not in ('delivered','declined'))::int as unassigned_open
     from requests`,
  );

  const matrixRows = await sql<{ product_area: ProductArea; status: RequestStatus; count: number }>(
    `select product_area, status, count(*)::int as count from requests group by product_area, status`,
  );
  const byArea = PRODUCT_AREAS.map((area) => {
    const counts = Object.fromEntries(REQUEST_STATUSES.map((s) => [s, 0])) as Record<RequestStatus, number>;
    for (const row of matrixRows) if (row.product_area === area) counts[row.status] = row.count;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return { area, counts, total };
  }).sort((a, b) => b.total - a.total);

  const statusTotals = Object.fromEntries(REQUEST_STATUSES.map((s) => [s, 0])) as Record<RequestStatus, number>;
  for (const row of matrixRows) statusTotals[row.status] += row.count;

  const weekly = await sql<{ week: Date; count: number }>(
    `select date_trunc('week', submitted_at) as week, count(*)::int as count from requests
     where submitted_at >= date_trunc('week', now()) - interval '11 weeks'
     group by 1 order by 1`,
  );
  const weeks: { week: string; count: number }[] = [];
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const day = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - day - 7 * 11);
  for (let i = 0; i < 12; i++) {
    const week = new Date(start.getTime() + i * 7 * 86400000);
    const match = weekly.find((w) => new Date(w.week).toISOString().slice(0, 10) === week.toISOString().slice(0, 10));
    weeks.push({ week: week.toISOString(), count: match?.count ?? 0 });
  }

  return { totals, byArea, statusTotals, weeks };
}
