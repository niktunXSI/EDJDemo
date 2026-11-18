"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Cable, LayoutDashboard, ListChecks, MessageSquarePlus, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/requests", label: "Request queue", icon: ListChecks, exclude: "/requests/new" },
  { href: "/requests/new", label: "Submit feedback", icon: MessageSquarePlus },
  { href: "/clients", label: "Clients & households", icon: UsersRound },
  { href: "/advisors", label: "Financial advisors", icon: Building2 },
  { href: "/integrations", label: "Integrations", icon: Cable },
];

export function SidebarNav({ onNavigate, counts }: { onNavigate?: () => void; counts?: { newRequests: number } }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : (pathname === item.href || pathname.startsWith(`${item.href}/`)) && !(item.exclude && pathname.startsWith(item.exclude));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-[5px] px-3 py-2 text-[13.5px] font-medium transition-colors",
              active ? "bg-white/[0.09] text-white" : "text-[#cdd8d1] hover:bg-white/[0.05] hover:text-white",
            )}
          >
            {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-[#c9a14a]" />}
            <Icon className={cn("size-[17px]", active ? "text-[#e2cb94]" : "text-[#8fa89b] group-hover:text-[#cdd8d1]")} />
            <span className="flex-1">{item.label}</span>
            {item.href === "/requests" && counts && counts.newRequests > 0 && (
              <span className="rounded-full bg-[#c9a14a]/20 px-1.5 text-[11px] font-semibold tabular text-[#e8d6a8]">
                {counts.newRequests}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
