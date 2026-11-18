import Link from "next/link";
import { Building2 } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { listAdvisors } from "@/lib/server/directory";

export const metadata = { title: "Financial advisors" };

export default async function AdvisorsPage() {
  const advisors = await listAdvisors();
  return (
    <>
      <PageHeader
        title="Financial advisors"
        description="Synthetic advisors who submit feedback on behalf of their clients and branch teams."
        breadcrumbs={[{ label: "Overview", href: "/" }, { label: "Financial advisors" }]}
      />
      {advisors.length === 0 ? (
        <div className="rounded-md border border-border bg-card">
          <EmptyState icon={<Building2 className="size-5" />} title="No advisors" description="Reset the demo data to reseed synthetic advisors." />
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead className="border-b border-border bg-[#f7f4ec] text-[12px] text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2.5 pl-5 pr-3 text-left font-medium">Advisor</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-medium">Branch</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-medium">Region</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Households</th>
                  <th scope="col" className="py-2.5 pl-3 pr-5 text-right font-medium">Submissions (open)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {advisors.map((a) => (
                  <tr key={a.id} className="hover:bg-[#faf8f2]">
                    <td className="py-3 pl-5 pr-3">
                      <Link href={`/advisors/${a.id}`} className="group flex items-center gap-3">
                        <Avatar className="size-8">
                          <AvatarFallback className="bg-[#e1ede6] text-[11.5px] font-semibold text-[#1d4a37]">{initials(a.name)}</AvatarFallback>
                        </Avatar>
                        <span>
                          <span className="block font-medium text-foreground group-hover:text-[#1d4a37] group-hover:underline underline-offset-4">{a.name}</span>
                          <span className="text-[11.5px] text-muted-foreground">
                            {a.title} since {a.joinedYear}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      {a.branch}
                      <p className="text-[11.5px] text-muted-foreground">
                        {a.city}, {a.state}
                      </p>
                    </td>
                    <td className="px-3 py-3">{a.region}</td>
                    <td className="px-3 py-3 text-right tabular">{a.clientCount}</td>
                    <td className="py-3 pl-3 pr-5 text-right tabular">
                      <Link href={`/requests?advisorId=${a.id}`} className="hover:underline underline-offset-4">
                        <span className="font-semibold">{a.submissionCount}</span>
                        <span className="text-muted-foreground"> ({a.openSubmissionCount})</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
