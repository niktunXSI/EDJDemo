"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { CopyButton } from "./code-block";

export function CredentialField({
  which,
  label,
  description,
  masked,
  managedBy,
  rotateWarning,
  canAdmin,
}: {
  which: "secret" | "apiKey";
  label: string;
  description: string;
  masked: string | null;
  managedBy: string | null;
  rotateWarning: string;
  canAdmin: boolean;
}) {
  const router = useRouter();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reveal() {
    if (revealed) {
      setRevealed(null);
      return;
    }
    setBusy(true);
    try {
      const { value } = await apiFetch<{ value: string }>("/api/integrations/credentials", { body: { which, action: "reveal" } });
      setRevealed(value);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    setBusy(true);
    try {
      await apiFetch("/api/integrations/credentials", { body: { which, action: "rotate" } });
      setRevealed(null);
      toast.success(`${label} rotated`, { description: "Update the external workflow with the new value." });
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13.5px] font-medium">{label}</p>
        {managedBy && <span className="text-[11.5px] text-muted-foreground">Managed by {managedBy}</span>}
      </div>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{description}</p>
      {!canAdmin && !managedBy ? (
        <p className="mt-2 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 font-mono text-[12.5px] text-muted-foreground">
          {masked ?? "Not configured"} <span className="font-sans">· administrators only</span>
        </p>
      ) : managedBy ? (
        <p className="mt-2 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 font-mono text-[12.5px] text-muted-foreground">
          {masked ?? "Configured in the environment; not displayed."}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-[#fbf9f3] px-3 py-2 font-mono text-[12.5px]">
            {revealed ?? masked ?? "Not configured"}
          </code>
          <Button variant="outline" size="sm" onClick={reveal} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : revealed ? <EyeOff /> : <Eye />}
            {revealed ? "Hide" : "Reveal"}
          </Button>
          {revealed && <CopyButton value={revealed} />}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" disabled={busy}>
                <RefreshCw /> Rotate
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Rotate {label.toLowerCase()}?</AlertDialogTitle>
                <AlertDialogDescription>{rotateWarning}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={rotate}>Rotate now</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}
