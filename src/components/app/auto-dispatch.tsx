"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

/**
 * While deliveries are waiting for a retry, periodically asks the server to process due
 * deliveries. This complements the inline worker and the cron endpoint on serverless hosts,
 * where no long-running process exists between requests.
 */
export function AutoDispatch({ active, intervalMs = 10000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const tick = async () => {
      try {
        const result = await apiFetch<{ processed: number; leasesReleased: number }>("/api/integrations/dispatch", { body: {} });
        if (!stopped && (result.processed > 0 || result.leasesReleased > 0)) router.refresh();
      } catch {
        // Next tick retries; failures are visible in the delivery log.
      }
    };
    const timer = setInterval(tick, intervalMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active, intervalMs, router]);
  return null;
}
