import Link from "next/link";
import { UsersRound } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { SegmentPill } from "@/components/app/segment-pill";
import { tenureLabel } from "@/lib/format";
import { listClients } from "@/lib/server/directory";

export const metadata = { title: "Clients & households" };

export default async function ClientsPage() {
  const clients = await listClients();
  const now = new Date();
  return (
    <>
      <PageHeader
        title="Clients & households"
        description="Synthetic households linked to feedback. This directory gives product teams context on who is affected; it is not a client record system."
        breadcrumbs={[{ label: "Overview", href: "/" }, { label: "Clients & households" }]}
      />
      <div className="overflow-hidden rounded-md border border-border bg-card">
        {clients.length === 0 ? (
          <EmptyState icon={<UsersRound className="size-5" />} title="No households" description="Reset the demo data to reseed synthetic households." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead className="border-b border-border bg-[#f7f4ec] text-[12px] text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2.5 pl-5 pr-3 text-left font-medium">Household</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-medium">Segment</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-medium">Region</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-medium">Relationship tenure</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-medium">Assigned advisor</th>
                  <th scope="col" className="py-2.5 pl-3 pr-5 text-right font-medium">Requests (open)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {clients.map((c) => (
                  <tr key={c.id} className="hover:bg-[#faf8f2]">
                    <td className="py-3 pl-5 pr-3">
                      <Link href={`/clients/${c.id}`} className="font-medium text-foreground hover:text-[#1d4a37] hover:underline underline-offset-4">
                        {c.householdName}
                      </Link>
                      <p className="text-[11.5px] text-muted-foreground">
                        {c.id} · {c.primaryContact}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <SegmentPill segment={c.segment} />
                    </td>
                    <td className="px-3 py-3">
                      {c.region}
                      <p className="text-[11.5px] text-muted-foreground">
                        {c.city}, {c.state}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      {tenureLabel(c.relationshipSince, now)}
                      <p className="text-[11.5px] text-muted-foreground">Since {c.relationshipSince.slice(0, 4)}</p>
                    </td>
                    <td className="px-3 py-3">
                      <Link href={`/advisors/${c.advisor.id}`} className="hover:underline underline-offset-4">
                        {c.advisor.name}
                      </Link>
                      <p className="text-[11.5px] text-muted-foreground">{c.advisor.branch}</p>
                    </td>
                    <td className="py-3 pl-3 pr-5 text-right tabular">
                      <Link href={`/requests?clientId=${c.id}`} className="hover:underline underline-offset-4">
                        <span className="font-semibold">{c.requestCount}</span>
                        <span className="text-muted-foreground"> ({c.openRequestCount})</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
