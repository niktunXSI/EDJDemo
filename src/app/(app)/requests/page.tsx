import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, MessageSquarePlus, SearchX } from "lucide-react";
import { ZodError } from "zod";
import { AutomationBadge, PriorityIndicator, StatusBadge } from "@/components/app/badges";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { RequestFilters } from "@/components/app/request-filters";
import { Button } from "@/components/ui/button";
import { PRODUCT_AREA_LABELS, TYPE_LABELS } from "@/lib/domain";
import { formatDate } from "@/lib/format";
import { listRequests } from "@/lib/server/requests";
import { parseListQuery, type ListQuery } from "@/lib/validation";
import { cn } from "@/lib/utils";

export const metadata = { title: "Request queue" };

type SearchParams = Record<string, string | string[] | undefined>;

function toParams(sp: SearchParams) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else if (value !== undefined) params.set(key, value);
  }
  return params;
}

function hrefWith(params: URLSearchParams, changes: Record<string, string | null>) {
  const next = new URLSearchParams(params.toString());
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `/requests?${qs}` : "/requests";
}

function SortHeader({
  label,
  sortKey,
  filters,
  params,
  className,
}: {
  label: string;
  sortKey: ListQuery["sort"];
  filters: ListQuery;
  params: URLSearchParams;
  className?: string;
}) {
  const active = filters.sort === sortKey;
  const nextDir = active && filters.dir === "desc" ? "asc" : "desc";
  const Icon = !active ? ArrowUpDown : filters.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <th
      scope="col"
      aria-sort={active ? (filters.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-3 py-2.5 text-left font-medium", className)}
    >
      <Link
        href={hrefWith(params, { sort: sortKey, dir: nextDir, page: null })}
        className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}
        scroll={false}
      >
        {label}
        <Icon className={cn("size-3", !active && "opacity-40")} />
      </Link>
    </th>
  );
}

export default async function RequestQueuePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = toParams(await searchParams);
  let filters: ListQuery;
  let invalid = false;
  try {
    filters = parseListQuery(params);
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    invalid = true;
    filters = parseListQuery(new URLSearchParams());
  }
  const result = await listRequests(filters);
  const hasFilters = [...params.keys()].some((k) => !["sort", "dir", "page", "pageSize"].includes(k));
  const start = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const end = Math.min(result.page * result.pageSize, result.total);

  return (
    <>
      <PageHeader
        title="Feedback & enhancement requests"
        description="Every piece of client and advisor feedback, triaged by business status. Automation status is tracked separately and reflects only the external workflow."
        breadcrumbs={[{ label: "Overview", href: "/" }, { label: "Request queue" }]}
        actions={
          <Button asChild>
            <Link href="/requests/new">
              <MessageSquarePlus /> Submit feedback
            </Link>
          </Button>
        }
      >
        <RequestFilters total={result.total} />
      </PageHeader>

      {invalid && (
        <p className="mb-4 rounded-md border border-[#e5d3a4] bg-[#fbf5e6] px-4 py-2.5 text-[13px] text-[#6a4c0f]">
          Some filters in the address were not recognised and were ignored.
        </p>
      )}

      <div className="overflow-hidden rounded-md border border-border bg-card">
        {result.items.length === 0 ? (
          <EmptyState
            icon={<SearchX className="size-5" />}
            title={hasFilters ? "No requests match these filters" : "No requests yet"}
            description={
              hasFilters
                ? "Try removing a filter or broadening your search. Search covers titles, feedback, requested outcomes, households, advisors, and tags."
                : "Feedback submitted by advisors and internal teams will appear here."
            }
            action={
              hasFilters ? (
                <Button variant="outline" asChild>
                  <Link href="/requests">Clear filters</Link>
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/requests/new">Submit the first request</Link>
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] border-collapse text-[13px]">
              <thead className="border-b border-border bg-[#f7f4ec] text-[12px] text-muted-foreground">
                <tr>
                  <SortHeader label="ID" sortKey="id" filters={filters} params={params} className="w-[96px] whitespace-nowrap pl-4" />
                  <SortHeader label="Title" sortKey="title" filters={filters} params={params} />
                  <th scope="col" className="px-3 py-2.5 text-left font-medium">Client / household</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-medium">Advisor</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-medium">Product area</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-medium">Type</th>
                  <SortHeader label="Priority" sortKey="priority" filters={filters} params={params} />
                  <SortHeader label="Status" sortKey="status" filters={filters} params={params} />
                  <SortHeader label="Automation" sortKey="automation" filters={filters} params={params} />
                  <SortHeader label="Submitted" sortKey="submitted" filters={filters} params={params} className="pr-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {result.items.map((item) => (
                  <tr key={item.id} className="group relative hover:bg-[#faf8f2]">
                    <td className="whitespace-nowrap py-3 pl-4 pr-3 align-top font-mono text-[12px] text-muted-foreground">{item.id}</td>
                    <td className="min-w-[240px] max-w-[320px] px-3 py-3 align-top">
                      <Link
                        href={`/requests/${item.id}`}
                        className="font-medium text-foreground after:absolute after:inset-0 group-hover:text-[#1d4a37] group-hover:underline underline-offset-4"
                      >
                        {item.title}
                      </Link>
                      {item.tags.length > 0 && (
                        <p className="mt-1 truncate text-[11.5px] text-muted-foreground">{item.tags.map((t) => `#${t}`).join("  ")}</p>
                      )}
                    </td>
                    <td className="min-w-[150px] px-3 py-3 align-top">
                      {item.client ? (
                        <Link href={`/clients/${item.client.id}`} className="relative z-10 hover:underline underline-offset-4">
                          {item.client.householdName}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Advisor-originated</span>
                      )}
                      {item.client && <p className="text-[11.5px] text-muted-foreground">{item.client.segment}</p>}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <Link href={`/advisors/${item.advisor.id}`} className="relative z-10 hover:underline underline-offset-4">
                        {item.advisor.name}
                      </Link>
                      <p className="truncate text-[11.5px] text-muted-foreground">{item.advisor.branch}</p>
                    </td>
                    <td className="px-3 py-3 align-top text-foreground/90">{PRODUCT_AREA_LABELS[item.productArea]}</td>
                    <td className="px-3 py-3 align-top text-foreground/90">{TYPE_LABELS[item.requestType]}</td>
                    <td className="px-3 py-3 align-top">
                      <PriorityIndicator priority={item.priority} />
                    </td>
                    <td className="px-3 py-3 align-top">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="px-3 py-3 align-top">
                      <AutomationBadge status={item.automationStatus} />
                      {item.externalIssue && (
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                          {item.externalIssue.key}
                          {item.externalIssue.isSample && " · sample"}
                        </p>
                      )}
                    </td>
                    <td className="py-3 pl-3 pr-4 align-top text-muted-foreground tabular">{formatDate(item.submittedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result.total > 0 && (
          <div className="flex flex-col items-center justify-between gap-3 border-t border-border bg-[#fbf9f3] px-4 py-2.5 text-[12.5px] text-muted-foreground sm:flex-row">
            <span>
              Showing <span className="font-medium text-foreground tabular">{start}</span>–<span className="font-medium text-foreground tabular">{end}</span> of{" "}
              <span className="font-medium text-foreground tabular">{result.total}</span>
            </span>
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline">Rows per page</span>
              {[10, 25, 50].map((size) => (
                <Link
                  key={size}
                  href={hrefWith(params, { pageSize: String(size), page: null })}
                  className={cn("rounded px-1.5 py-0.5", result.pageSize === size ? "bg-muted font-semibold text-foreground" : "hover:text-foreground")}
                  scroll={false}
                >
                  {size}
                </Link>
              ))}
              <span className="mx-2 h-4 w-px bg-border" />
              <Button variant="outline" size="icon-sm" asChild={result.page > 1} disabled={result.page <= 1} aria-label="Previous page">
                {result.page > 1 ? (
                  <Link href={hrefWith(params, { page: String(result.page - 1) })} scroll={false}>
                    <ChevronLeft />
                  </Link>
                ) : (
                  <ChevronLeft />
                )}
              </Button>
              <span className="tabular">
                Page {result.page} of {result.totalPages}
              </span>
              <Button variant="outline" size="icon-sm" asChild={result.page < result.totalPages} disabled={result.page >= result.totalPages} aria-label="Next page">
                {result.page < result.totalPages ? (
                  <Link href={hrefWith(params, { page: String(result.page + 1) })} scroll={false}>
                    <ChevronRight />
                  </Link>
                ) : (
                  <ChevronRight />
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
