import Link from "next/link";
import type { RequestListItem } from "@/lib/server/requests";
import { PRODUCT_AREA_LABELS } from "@/lib/domain";
import { formatDate } from "@/lib/format";
import { AutomationBadge, PriorityIndicator, StatusBadge } from "./badges";
import { EmptyState } from "./page-header";

export function RequestMiniTable({ items, showClient = false, emptyText }: { items: RequestListItem[]; showClient?: boolean; emptyText: string }) {
  if (!items.length) return <EmptyState title="No requests" description={emptyText} className="py-10" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-[13px]">
        <thead className="border-b border-border bg-[#f7f4ec] text-[12px] text-muted-foreground">
          <tr>
            <th scope="col" className="py-2 pl-5 pr-3 text-left font-medium">Request</th>
            {showClient && <th scope="col" className="px-3 py-2 text-left font-medium">Client / household</th>}
            <th scope="col" className="px-3 py-2 text-left font-medium">Product area</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Priority</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Status</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Automation</th>
            <th scope="col" className="py-2 pl-3 pr-5 text-left font-medium">Submitted</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-[#faf8f2]">
              <td className="py-2.5 pl-5 pr-3">
                <Link href={`/requests/${item.id}`} className="font-medium text-foreground hover:text-[#1d4a37] hover:underline underline-offset-4">
                  <span className="mr-2 font-mono text-[11.5px] text-muted-foreground">{item.id}</span>
                  {item.title}
                </Link>
              </td>
              {showClient && (
                <td className="px-3 py-2.5">
                  {item.client ? (
                    <Link href={`/clients/${item.client.id}`} className="hover:underline underline-offset-4">
                      {item.client.householdName}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Advisor-originated</span>
                  )}
                </td>
              )}
              <td className="px-3 py-2.5">{PRODUCT_AREA_LABELS[item.productArea]}</td>
              <td className="px-3 py-2.5">
                <PriorityIndicator priority={item.priority} />
              </td>
              <td className="px-3 py-2.5">
                <StatusBadge status={item.status} />
              </td>
              <td className="px-3 py-2.5">
                <AutomationBadge status={item.automationStatus} />
              </td>
              <td className="py-2.5 pl-3 pr-5 text-muted-foreground tabular">{formatDate(item.submittedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
