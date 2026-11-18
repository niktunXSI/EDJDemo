"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { initials } from "@/lib/format";

interface Persona {
  id: string;
  name: string;
  role: string;
  team: string;
  email: string;
}

export function AccountMenu({
  persona,
  personas,
  sessionId,
  demoMode,
  viewer,
}: {
  persona: Persona;
  personas: Persona[];
  sessionId: string;
  demoMode: boolean;
  viewer: { name: string; simulated: boolean } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [resetOpen, setResetOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [resetting, setResetting] = useState(false);

  async function switchPersona(id: string) {
    if (id === persona.id) return;
    try {
      const { persona: next } = await apiFetch<{ persona: Persona }>("/api/session/persona", { body: { personaId: id } });
      toast.success(`Now acting as ${next.name}`, { description: `${next.role}, ${next.team}` });
      startTransition(() => router.refresh());
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function resetDemo() {
    setResetting(true);
    try {
      await apiFetch("/api/demo/reset", { body: { confirm } });
      toast.success("Demo data reset", { description: "Synthetic requests, clients, and advisors were reseeded." });
      setResetOpen(false);
      setConfirm("");
      router.push("/");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setResetting(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2.5 rounded-md py-1 pl-1 pr-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            disabled={pending}
          >
            <Avatar className="size-8 border border-[#d8c393]">
              <AvatarFallback className="bg-[#1d4a37] text-[12px] font-semibold text-[#f6f0de]">{initials(persona.name)}</AvatarFallback>
            </Avatar>
            <span className="hidden flex-col leading-tight sm:flex">
              <span className="text-[13px] font-semibold text-foreground">{persona.name}</span>
              <span className="text-[11.5px] text-muted-foreground">{persona.role}</span>
            </span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
            <span className="text-sm font-semibold">{persona.name}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {persona.role} · {persona.team}
            </span>
            <span className="text-xs font-normal text-muted-foreground">{persona.email}</span>
          </DropdownMenuLabel>
          <div className="mx-2 mb-2 flex items-start gap-2 rounded-md bg-[#fbf5e6] px-2.5 py-2 text-[11.5px] text-[#6a4c0f]">
            <ShieldCheck className="mt-px size-3.5 shrink-0" />
            <span>
              Demo session <span className="font-mono">{sessionId.slice(0, 13)}</span>
              {viewer ? (viewer.simulated ? " · local simulated viewer" : ` · signed in as ${viewer.name}`) : ""}. Actions are attributed to the
              selected demo persona.
            </span>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Act as</DropdownMenuLabel>
          {personas.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => switchPersona(p.id)} className="flex items-start gap-2">
              <Check className={p.id === persona.id ? "mt-0.5 size-4 text-[#1d4a37]" : "mt-0.5 size-4 opacity-0"} />
              <span className="flex flex-col">
                <span className="text-[13px] font-medium">{p.name}</span>
                <span className="text-xs text-muted-foreground">{p.role}</span>
              </span>
            </DropdownMenuItem>
          ))}
          {demoMode && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setResetOpen(true)} className="text-[#9b1c13] focus:text-[#9b1c13]">
                <RotateCcw className="size-4" />
                Reset demo data…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={resetOpen} onOpenChange={(open) => (setResetOpen(open), setConfirm(""))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset demo data</DialogTitle>
            <DialogDescription>
              This deletes every request, note, activity event, automation job, and webhook delivery in this demo environment, then
              reseeds the synthetic dataset. Integration settings and credentials are kept.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reset-confirm">
              Type <span className="font-mono font-semibold">RESET</span> to confirm
            </Label>
            <Input id="reset-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={confirm !== "RESET" || resetting} onClick={resetDemo}>
              {resetting ? "Resetting…" : "Reset and reseed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
