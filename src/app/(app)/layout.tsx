import { AccountMenu } from "@/components/app/account-menu";
import { DemoIndicator } from "@/components/app/demo-indicator";
import { MobileNav } from "@/components/app/mobile-nav";
import { SidebarNav } from "@/components/app/sidebar-nav";
import { Wordmark } from "@/components/app/wordmark";
import { config } from "@/lib/server/config";
import { sql } from "@/lib/server/db";
import { getDemoSession, listPersonas } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const [{ persona, sessionId }, personas, [counts]] = await Promise.all([
    getDemoSession(),
    listPersonas(),
    sql<{ new_requests: number }>("select count(*)::int as new_requests from requests where status = 'new'"),
  ]);
  const navCounts = { newRequests: counts?.new_requests ?? 0 };

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-black/10 bg-[#143728] lg:flex">
        <div className="px-6 pb-7 pt-6">
          <Wordmark />
        </div>
        <div className="flex-1 overflow-y-auto px-3">
          <p className="px-3 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#7f998b]">Workspace</p>
          <SidebarNav counts={navCounts} />
        </div>
        <div className="border-t border-white/10 px-5 py-4 text-[11.5px] leading-relaxed text-[#9fb3a8]">
          <p className="font-medium text-[#d6e0da]">Product Insights Program</p>
          <p>Client Experience · Digital Platforms</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-[#fbf9f3]/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-[#fbf9f3]/80 sm:px-6">
          <MobileNav counts={navCounts} />
          <span className="font-serif text-[15px] font-semibold text-[#1d4a37] lg:hidden">Edward Jones</span>
          <div className="ml-auto flex items-center gap-3">
            <DemoIndicator className="hidden md:inline-flex" />
            <AccountMenu persona={persona} personas={personas} sessionId={sessionId} demoMode={config.demoMode} />
          </div>
        </header>
        <main className="flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
        <div className="border-t px-6 py-3 text-center md:hidden">
          <DemoIndicator />
        </div>
      </div>
    </div>
  );
}
