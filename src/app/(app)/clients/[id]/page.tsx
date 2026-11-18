import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageSquarePlus } from "lucide-react";
import { FieldRow, PageHeader, Panel } from "@/components/app/page-header";
import { RequestMiniTable } from "@/components/app/request-mini-table";
import { SegmentPill } from "@/components/app/segment-pill";
import { Button } from "@/components/ui/button";
import { PRODUCT_AREA_LABELS, type ProductArea } from "@/lib/domain";
import { formatDate, tenureLabel } from "@/lib/format";
import { getClient } from "@/lib/server/directory";
import { listRequests } from "@/lib/server/requests";
import { listQuerySchema } from "@/lib/validation";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const client = await getClient((await params).id);
  return { title: client?.householdName ?? "Household" };
}

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await getClient(id);
  if (!client) notFound();
  const now = new Date();
  const requests = await listRequests(listQuerySchema.parse({ clientId: client.id, pageSize: 100 }));
  const areas = new Map<ProductArea, number>();
  for (const r of requests.items) areas.set(r.productArea, (areas.get(r.productArea) ?? 0) + 1);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Overview", href: "/" }, { label: "Clients & households", href: "/clients" }, { label: client.householdName }]}
        eyebrow={
          <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <span className="font-mono">{client.id}</span>
            <SegmentPill segment={client.segment} />
          </div>
        }
        title={client.householdName}
        description={`${client.primaryContact} · ${client.city}, ${client.state} · client for ${tenureLabel(client.relationshipSince, now).toLowerCase()}`}
        actions={
          <Button asChild>
            <Link href="/requests/new">
              <MessageSquarePlus /> Submit feedback
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="Feedback from this household" description={`${requests.total} request${requests.total === 1 ? "" : "s"}, ${client.openRequestCount} open`} bodyClassName="p-0">
          <RequestMiniTable items={requests.items} emptyText="This household has not raised any feedback yet." />
        </Panel>
        <aside className="flex flex-col gap-6">
          <Panel title="Relationship">
            <dl>
              <FieldRow label="Primary contact">{client.primaryContact}</FieldRow>
              <FieldRow label="Segment">{client.segment}</FieldRow>
              <FieldRow label="Region">{client.region}</FieldRow>
              <FieldRow label="Location">
                {client.city}, {client.state}
              </FieldRow>
              <FieldRow label="Client since">{formatDate(client.relationshipSince)}</FieldRow>
              <FieldRow label="Tenure">{tenureLabel(client.relationshipSince, now)}</FieldRow>
              <FieldRow label="Household">{client.householdMembers} member{client.householdMembers === 1 ? "" : "s"}</FieldRow>
              <FieldRow label="Prefers">{client.preferredChannel}</FieldRow>
            </dl>
          </Panel>
          <Panel title="Assigned advisor">
            <Link href={`/advisors/${client.advisor.id}`} className="font-semibold text-foreground hover:underline underline-offset-4">
              {client.advisor.name}
            </Link>
            <p className="text-[12.5px] text-muted-foreground">{client.advisor.branch}</p>
          </Panel>
          {areas.size > 0 && (
            <Panel title="Feedback themes">
              <ul className="space-y-1.5 text-[13px]">
                {[...areas.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([area, count]) => (
                    <li key={area} className="flex justify-between">
                      <span>{PRODUCT_AREA_LABELS[area]}</span>
                      <span className="font-semibold tabular">{count}</span>
                    </li>
                  ))}
              </ul>
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}
