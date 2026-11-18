import { PageHeader } from "@/components/app/page-header";
import { RequestForm } from "@/components/app/request-form";
import { formOptions } from "@/lib/server/directory";
import { getSettings } from "@/lib/server/settings";

export const metadata = { title: "Submit feedback" };

export default async function NewRequestPage() {
  const [options, settings] = await Promise.all([formOptions(), getSettings()]);
  return (
    <>
      <PageHeader
        title="Submit client feedback"
        description="Capture feedback or an enhancement request from a client conversation, an advisor, or an operations team. Submissions go straight into the product review queue."
        breadcrumbs={[{ label: "Overview", href: "/" }, { label: "Request queue", href: "/requests" }, { label: "Submit feedback" }]}
      />
      <div className="max-w-5xl">
        <RequestForm options={{ clients: options.clients, advisors: options.advisors }} autoQueue={settings.autoQueue} />
      </div>
    </>
  );
}
