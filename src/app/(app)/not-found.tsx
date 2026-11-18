import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { EmptyState } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mt-10 rounded-md border border-border bg-card">
      <EmptyState
        icon={<FileQuestion className="size-5" />}
        title="We couldn't find that record"
        description="It may have been removed when the demo data was reset, or the link may be mistyped."
        action={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/">Overview</Link>
            </Button>
            <Button asChild>
              <Link href="/requests">Request queue</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}
