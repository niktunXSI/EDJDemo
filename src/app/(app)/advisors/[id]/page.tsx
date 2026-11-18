import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail } from "lucide-react";
import { FieldRow, PageHeader, Panel } from "@/components/app/page-header";
import { RequestMiniTable } from "@/components/app/request-mini-table";
import { SegmentPill } from "@/components/app/segment-pill";
import { tenureLabel } from "@/lib/format";
import { getAdvisor, listClientsForAdvisor } from "@/lib/server/directory";
import { listRequests } from "@/lib/server/requests";
import { listQuerySchema } from "@/lib/validation";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const advisor = await getAdvisor((await params).id);
  return { title: advisor?.name ?? "Advisor" };
}

export default async function AdvisorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const advisor = await getAdvisor(id);
  if (!advisor) notFound();
  const now = new Date();
  const [clients, submissions] = await Promise.all([
    listClientsForAdvisor(advisor.id),
    listRequests(listQuerySchema.parse({ advisorId: advisor.id, pageSize: 100 })),
  ]);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Overview", href: "/" }, { label: "Financial advisors", href: "/advisors" }, { label: advisor.name }]}
        eyebrow={<span className="font-mono text-[12.5px] text-muted-foreground">{advisor.id}</span>}
        title={advisor.name}
        description={`${advisor.title} · ${advisor.branch} · ${advisor.city}, ${advisor.state}`}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Submissions" description={`${submissions.total} submitted, ${advisor.openSubmissionCount} open`} bodyClassName="p-0">
            <RequestMiniTable items={submissions.items} showClient emptyText="This advisor has not submitted feedback yet." />
          </Panel>
        </div>
        <aside className="flex flex-col gap-6">
          <Panel title="Advisor">
            <dl>
              <FieldRow label="Branch">{advisor.branch}</FieldRow>
              <FieldRow label="Location">
                {advisor.city}, {advisor.state}
              </FieldRow>
              <FieldRow label="Region">{advisor.region}</FieldRow>
              <FieldRow label="With firm since">{advisor.joinedYear}</FieldRow>
            </dl>
            <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <Mail className="size-3.5" /> {advisor.email}
            </p>
          </Panel>
          <Panel title="Households" description={`${clients.length} assigned`}>
            {clients.length ? (
              <ul className="space-y-3">
                {clients.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-3">
                    <div>
                      <Link href={`/clients/${c.id}`} className="text-[13px] font-medium hover:underline underline-offset-4">
                        {c.householdName}
                      </Link>
                      <p className="text-[11.5px] text-muted-foreground">
                        {tenureLabel(c.relationshipSince, now)} · {c.requestCount} request{c.requestCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <SegmentPill segment={c.segment} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">No households assigned.</p>
            )}
          </Panel>
        </aside>
      </div>
    </>
  );
}
