"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PencilLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { CHANNELS, CHANNEL_LABELS, PRODUCT_AREAS, PRODUCT_AREA_LABELS, REQUEST_TYPES, TYPE_LABELS } from "@/lib/domain";
import { ApiClientError, apiFetch, errorMessage } from "@/lib/api-client";

export interface EditableRequest {
  id: string;
  revision: number;
  title: string;
  requestType: string;
  productArea: string;
  channel: string;
  clientId: string | null;
  advisorId: string;
  originalFeedback: string;
  problemStatement: string;
  requestedOutcome: string;
  currentWorkaround: string;
  businessImpact: string;
  expectedBenefit: string;
  tags: string[];
}

const NO_CLIENT = "__none";

const TEXT_FIELDS: { key: keyof EditableRequest; label: string; rows: number; required?: boolean }[] = [
  { key: "originalFeedback", label: "Original client feedback", rows: 4, required: true },
  { key: "problemStatement", label: "Problem statement", rows: 3 },
  { key: "requestedOutcome", label: "Requested enhancement", rows: 3, required: true },
  { key: "currentWorkaround", label: "Current workaround", rows: 2 },
  { key: "businessImpact", label: "Business impact", rows: 3, required: true },
  { key: "expectedBenefit", label: "Expected benefit", rows: 2 },
];

export function EditRequestSheet({
  request,
  options,
}: {
  request: EditableRequest;
  options: { clients: { id: string; householdName: string }[]; advisors: { id: string; name: string; branch: string }[] };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(request);
  const [tags, setTags] = useState(request.tags.join(", "));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  function reset(next: boolean) {
    if (next) {
      setValues(request);
      setTags(request.tags.join(", "));
      setErrors({});
    }
    setOpen(next);
  }

  const set = <K extends keyof EditableRequest>(key: K, value: EditableRequest[K]) => setValues((v) => ({ ...v, [key]: value }));

  async function save() {
    const body: Record<string, unknown> = { expectedRevision: request.revision };
    const parsedTags = tags
      .split(",")
      .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-"))
      .filter(Boolean);
    for (const key of Object.keys(values) as (keyof EditableRequest)[]) {
      if (key === "id" || key === "revision" || key === "tags") continue;
      if (values[key] !== request[key]) body[key] = values[key];
    }
    if (parsedTags.join(",") !== request.tags.join(",")) body.tags = parsedTags;
    if (Object.keys(body).length === 1) {
      setOpen(false);
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      const result = await apiFetch<{ revision: number }>(`/api/requests/${request.id}`, { method: "PATCH", body });
      toast.success(`Saved as revision ${result.revision}`);
      setOpen(false);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError && error.fields.length) {
        setErrors(Object.fromEntries(error.fields.map((f) => [f.path.split(".")[0], f.message])));
      }
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={reset}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <PencilLine /> Edit details
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle>Edit {request.id}</SheetTitle>
          <SheetDescription>
            Saving creates revision {request.revision + 1}. If this request is queued for automation, re-queue it so the workflow receives the
            updated content.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5">
          <div className="space-y-1.5">
            <Label htmlFor="edit-title">Title</Label>
            <Input id="edit-title" value={values.title} onChange={(e) => set("title", e.target.value)} aria-invalid={Boolean(errors.title)} />
            {errors.title && <p className="text-[12px] font-medium text-[#9b1c13]">{errors.title}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Request type</Label>
              <Select value={values.requestType} onValueChange={(v) => set("requestType", v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REQUEST_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Product area</Label>
              <Select value={values.productArea} onValueChange={(v) => set("productArea", v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_AREAS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {PRODUCT_AREA_LABELS[a]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Affected channel</Label>
              <Select value={values.channel} onValueChange={(v) => set("channel", v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CHANNEL_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Client or household</Label>
              <Select value={values.clientId ?? NO_CLIENT} onValueChange={(v) => set("clientId", v === NO_CLIENT ? null : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CLIENT}>No household (advisor-originated)</SelectItem>
                  {options.clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.householdName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Submitting advisor</Label>
              <Select value={values.advisorId} onValueChange={(v) => set("advisorId", v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.advisors.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {TEXT_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`edit-${field.key}`}>
                {field.label}
                {!field.required && <span className="font-normal text-muted-foreground"> (optional)</span>}
              </Label>
              <Textarea
                id={`edit-${field.key}`}
                rows={field.rows}
                value={values[field.key] as string}
                onChange={(e) => set(field.key, e.target.value as never)}
                aria-invalid={Boolean(errors[field.key])}
              />
              {errors[field.key] && <p className="text-[12px] font-medium text-[#9b1c13]">{errors[field.key]}</p>}
            </div>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor="edit-tags">Tags</Label>
            <Input id="edit-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Comma-separated, e.g. transfers, onboarding" />
            {errors.tags && <p className="text-[12px] font-medium text-[#9b1c13]">{errors.tags}</p>}
          </div>
        </div>
        <SheetFooter className="flex-row justify-end border-t">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Save changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
