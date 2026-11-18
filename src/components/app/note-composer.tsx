"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, errorMessage } from "@/lib/api-client";

export function NoteComposer({ requestId, authorName }: { requestId: string; authorName: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (body.trim().length < 2) {
      setError("Write a note before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/requests/${requestId}/notes`, { body: { body } });
      setBody("");
      toast.success("Note added");
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={body}
        onChange={(e) => (setBody(e.target.value), setError(null))}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void save();
        }}
        rows={3}
        placeholder="Add context for the product team: validation, dependencies, decisions…"
        aria-label="New internal note"
        aria-invalid={Boolean(error)}
      />
      <div className="flex items-center justify-between gap-3">
        <p className={error ? "text-[12px] font-medium text-[#9b1c13]" : "text-[12px] text-muted-foreground"}>
          {error ?? `Internal only. Posting as ${authorName}.`}
        </p>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Add note
        </Button>
      </div>
    </div>
  );
}
