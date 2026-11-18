"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DemoIndicator } from "./demo-indicator";
import { SidebarNav } from "./sidebar-nav";
import { Wordmark } from "./wordmark";

export function MobileNav({ counts }: { counts: { newRequests: number } }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 border-none bg-[#143728] p-0 text-white">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">Primary navigation for Client Product Insights</SheetDescription>
        <div className="flex h-full flex-col gap-6 px-4 py-6">
          <Wordmark className="px-2" />
          <SidebarNav counts={counts} onNavigate={() => setOpen(false)} />
          <div className="mt-auto px-2">
            <DemoIndicator tone="dark" />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
