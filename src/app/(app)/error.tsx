"use client";

import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mt-10 rounded-md border border-[#f2c7c2] bg-card">
      <EmptyState
        icon={<AlertTriangle className="size-5 text-[#9b1c13]" />}
        title="This page could not be loaded"
        description={
          <>
            Something went wrong while loading data. Try again; if the problem continues, check the server logs
            {error.digest ? (
              <>
                {" "}
                for reference <span className="font-mono">{error.digest}</span>
              </>
            ) : null}
            .
          </>
        }
        action={<Button onClick={reset}>Try again</Button>}
      />
    </div>
  );
}
