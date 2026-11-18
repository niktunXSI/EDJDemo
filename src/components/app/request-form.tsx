"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, ChevronsUpDown, Info, Loader2, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CHANNELS,
  CHANNEL_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  PRODUCT_AREAS,
  PRODUCT_AREA_LABELS,
  REQUEST_TYPES,
  TYPE_LABELS,
} from "@/lib/domain";
import { ApiClientError, apiFetch, errorMessage } from "@/lib/api-client";
import { createRequestSchema } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { PriorityIndicator } from "./badges";

interface Options {
  clients: { id: string; householdName: string; advisorId: string; segment: string; location: string }[];
  advisors: { id: string; name: string; branch: string }[];
}

type Values = {
  title: string;
  requestType: string;
  clientId: string | null;
  advisorId: string;
  productArea: string;
  channel: string;
  priority: string;
  originalFeedback: string;
  problemStatement: string;
  requestedOutcome: string;
  currentWorkaround: string;
  businessImpact: string;
  expectedBenefit: string;
  tags: string[];
};

const INITIAL: Values = {
  title: "",
  requestType: "enhancement",
  clientId: null,
  advisorId: "",
  productArea: "",
  channel: "client_web",
  priority: "medium",
  originalFeedback: "",
  problemStatement: "",
  requestedOutcome: "",
  currentWorkaround: "",
  businessImpact: "",
  expectedBenefit: "",
  tags: [],
};

const PRIORITY_HELP: Record<string, string> = {
  critical: "Clients are blocked or exposed to risk; needs attention this cycle.",
  high: "Significant friction for many clients or advisors.",
  medium: "Meaningful improvement with a workable alternative today.",
  low: "Nice to have; minor or infrequent friction.",
};

function Field({
  id,
  label,
  required,
  hint,
  error,
  children,
  counter,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  counter?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className="text-[13px] font-medium text-foreground">
          {label}
          {required ? <span className="text-[#9b1c13]" aria-hidden> *</span> : <span className="font-normal text-muted-foreground"> (optional)</span>}
        </Label>
        {counter && <span className="text-[11px] tabular text-muted-foreground">{counter}</span>}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-[12px] font-medium text-[#9b1c13]">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-[12px] leading-relaxed text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-6 border-b border-border/70 py-7 first:pt-2 last:border-b-0 lg:grid-cols-[260px_1fr]">
      <div>
        <h2 className="text-[14px] font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

export function RequestForm({ options, autoQueue }: { options: Options; autoQueue: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(INITIAL);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [clientOpen, setClientOpen] = useState(false);
  const [created, setCreated] = useState<{ id: string; autoQueued: boolean } | null>(null);

  const selectedClient = options.clients.find((c) => c.id === values.clientId) ?? null;
  const advisorsById = useMemo(() => new Map(options.advisors.map((a) => [a.id, a])), [options.advisors]);

  function validate(next: Values) {
    const parsed = createRequestSchema.safeParse(next);
    const map: Record<string, string> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!map[key]) map[key] = issue.message;
      }
    }
    return map;
  }

  function update<K extends keyof Values>(key: K, value: Values[K]) {
    const next = { ...values, [key]: value };
    setValues(next);
    if (touched[key as string] || Object.keys(errors).length) setErrors(validate(next));
  }

  function blur(key: keyof Values) {
    setTouched((t) => ({ ...t, [key]: true }));
    setErrors(validate(values));
  }

  function chooseClient(id: string | null) {
    const client = options.clients.find((c) => c.id === id);
    const next = { ...values, clientId: id, advisorId: client ? client.advisorId : values.advisorId };
    setValues(next);
    setClientOpen(false);
    if (Object.keys(errors).length) setErrors(validate(next));
  }

  function addTag(raw: string) {
    const parts = raw
      .split(",")
      .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-"))
      .filter(Boolean);
    if (!parts.length) return;
    update("tags", [...new Set([...values.tags, ...parts])].slice(0, 8));
    setTagDraft("");
  }

  const visibleError = (key: string) => (touched[key] || touched.__submit ? errors[key] : undefined);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const pendingTags = tagDraft.trim() ? [...new Set([...values.tags, ...tagDraft.split(",").map((t) => t.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean)])] : values.tags;
    const payload = { ...values, tags: pendingTags };
    const found = validate(payload);
    setTouched((t) => ({ ...t, __submit: true }));
    setErrors(found);
    if (Object.keys(found).length) {
      toast.error("Please review the highlighted fields.");
      const first = document.querySelector<HTMLElement>(`[name="${Object.keys(found)[0]}"]`);
      first?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const result = await apiFetch<{ id: string; autoQueued: boolean }>("/api/requests", { body: payload });
      setCreated(result);
      window.scrollTo({ top: 0, behavior: "smooth" });
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError && error.fields.length) {
        const map: Record<string, string> = {};
        for (const field of error.fields) map[field.path.split(".")[0]] = field.message;
        setErrors(map);
      }
      toast.error(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className="rounded-md border border-[#c0dccb] bg-card p-8">
        <div className="flex items-start gap-4">
          <CheckCircle2 className="mt-0.5 size-7 shrink-0 text-[#1f5c3b]" />
          <div className="space-y-2">
            <h2 className="font-serif text-[22px] font-semibold text-[#18231d]">Feedback submitted as {created.id}</h2>
            <p className="max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
              The request is now in the queue with a status of <strong className="text-foreground">New</strong> and appears on the overview
              dashboard.{" "}
              {created.autoQueued
                ? "Automatic queueing is enabled, so it was also queued for automation and a webhook event was sent."
                : "It has not been sent to automation; product owners can review it and queue it from the request page."}
            </p>
            <div className="flex flex-wrap gap-2 pt-3">
              <Button asChild>
                <Link href={`/requests/${created.id}`}>Open {created.id}</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/requests">Go to request queue</Link>
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setCreated(null);
                  setValues(INITIAL);
                  setErrors({});
                  setTouched({});
                }}
              >
                Submit another
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const describedBy = (key: string) => (visibleError(key) ? `${key}-error` : `${key}-hint`);

  return (
    <form onSubmit={submit} noValidate className="rounded-md border border-border bg-card px-6 sm:px-8">
      <div className="mt-6 flex items-start gap-3 rounded-md border border-[#e5d3a4] bg-[#fbf5e6] px-4 py-3 text-[12.5px] leading-relaxed text-[#6a4c0f]">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <p>
          Describe the product experience only. Do not include Social Security numbers, full account numbers, credentials, or balances. Refer
          to accounts by type (for example, “joint brokerage” or “IRA”).
        </p>
      </div>

      <Section title="Request summary" description="A clear, specific title helps product teams triage quickly.">
        <Field id="title" label="Request title" required hint="Describe the outcome, not the solution. 8–140 characters." error={visibleError("title")} counter={`${values.title.length}/140`}>
          <Input
            id="title"
            name="title"
            value={values.title}
            onChange={(e) => update("title", e.target.value)}
            onBlur={() => blur("title")}
            placeholder="e.g. Show estimated completion dates for incoming transfers"
            maxLength={140}
            aria-invalid={Boolean(visibleError("title"))}
            aria-describedby={describedBy("title")}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="requestType" label="Request type" required hint="Defects are broken behavior; enhancements add capability.">
            <Select value={values.requestType} onValueChange={(v) => update("requestType", v)} name="requestType">
              <SelectTrigger id="requestType" className="w-full">
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
          </Field>
          <Field id="productArea" label="Product area" required hint="Where the experience lives today." error={visibleError("productArea")}>
            <Select value={values.productArea} onValueChange={(v) => (update("productArea", v), setTouched((t) => ({ ...t, productArea: true })))} name="productArea">
              <SelectTrigger id="productArea" className="w-full" aria-invalid={Boolean(visibleError("productArea"))}>
                <SelectValue placeholder="Select a product area" />
              </SelectTrigger>
              <SelectContent>
                {PRODUCT_AREAS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {PRODUCT_AREA_LABELS[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="channel" label="Affected channel" required hint="The surface where clients or advisors encounter this.">
            <Select value={values.channel} onValueChange={(v) => update("channel", v)} name="channel">
              <SelectTrigger id="channel" className="w-full">
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
          </Field>
          <Field id="priority" label="Priority" required hint={PRIORITY_HELP[values.priority]}>
            <Select value={values.priority} onValueChange={(v) => update("priority", v)} name="priority">
              <SelectTrigger id="priority" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    <PriorityIndicator priority={p} showLabel={false} />
                    {PRIORITY_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Section>

      <Section title="Client and advisor" description="Link the household that raised the feedback, if any. Selecting a household fills in its assigned advisor.">
        <Field id="clientId" label="Client or household" hint="Leave empty for advisor- or operations-originated feedback.">
          <Popover open={clientOpen} onOpenChange={setClientOpen}>
            <PopoverTrigger asChild>
              <Button id="clientId" variant="outline" role="combobox" aria-expanded={clientOpen} className="w-full justify-between bg-transparent font-normal hover:bg-muted/40">
                {selectedClient ? (
                  <span className="truncate">
                    {selectedClient.householdName} <span className="text-muted-foreground">· {selectedClient.segment} · {selectedClient.location}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Search households…</span>
                )}
                <ChevronsUpDown className="opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[320px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search by household or ID…" />
                <CommandList>
                  <CommandEmpty>No household found.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem value="none advisor-originated" onSelect={() => chooseClient(null)}>
                      <Check className={cn("size-4", values.clientId === null ? "opacity-100" : "opacity-0")} />
                      <span className="text-muted-foreground">No household (advisor-originated)</span>
                    </CommandItem>
                    {options.clients.map((c) => (
                      <CommandItem key={c.id} value={`${c.householdName} ${c.id}`} onSelect={() => chooseClient(c.id)}>
                        <Check className={cn("size-4", values.clientId === c.id ? "opacity-100" : "opacity-0")} />
                        <span className="flex flex-col">
                          <span>{c.householdName}</span>
                          <span className="text-[11.5px] text-muted-foreground">
                            {c.id} · {c.segment} · {c.location} · {advisorsById.get(c.advisorId)?.name}
                          </span>
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </Field>
        <Field id="advisorId" label="Submitting financial advisor" required hint="The advisor who heard or raised the feedback." error={visibleError("advisorId")}>
          <Select value={values.advisorId} onValueChange={(v) => (update("advisorId", v), setTouched((t) => ({ ...t, advisorId: true })))} name="advisorId">
            <SelectTrigger id="advisorId" className="w-full" aria-invalid={Boolean(visibleError("advisorId"))}>
              <SelectValue placeholder="Select an advisor" />
            </SelectTrigger>
            <SelectContent>
              {options.advisors.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} <span className="text-muted-foreground">· {a.branch}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Section>

      <Section title="Feedback detail" description="Capture what the client said in their words, then the outcome they need. Product teams use this to write engineering tickets.">
        <Field id="originalFeedback" label="Detailed feedback" required hint="What happened, in the client's or advisor's words. At least 20 characters." error={visibleError("originalFeedback")} counter={`${values.originalFeedback.length}/4000`}>
          <Textarea id="originalFeedback" name="originalFeedback" rows={5} value={values.originalFeedback} onChange={(e) => update("originalFeedback", e.target.value)} onBlur={() => blur("originalFeedback")} aria-invalid={Boolean(visibleError("originalFeedback"))} aria-describedby={describedBy("originalFeedback")} placeholder="The client explained that…" />
        </Field>
        <Field id="problemStatement" label="Problem statement" hint="The underlying product problem, stated neutrally." error={visibleError("problemStatement")}>
          <Textarea id="problemStatement" name="problemStatement" rows={3} value={values.problemStatement} onChange={(e) => update("problemStatement", e.target.value)} onBlur={() => blur("problemStatement")} aria-describedby={describedBy("problemStatement")} />
        </Field>
        <Field id="requestedOutcome" label="Requested outcome" required hint="What would good look like for the client or advisor?" error={visibleError("requestedOutcome")}>
          <Textarea id="requestedOutcome" name="requestedOutcome" rows={3} value={values.requestedOutcome} onChange={(e) => update("requestedOutcome", e.target.value)} onBlur={() => blur("requestedOutcome")} aria-invalid={Boolean(visibleError("requestedOutcome"))} aria-describedby={describedBy("requestedOutcome")} />
        </Field>
        <Field id="currentWorkaround" label="Current workaround" hint="How clients, advisors, or branch teams cope today." error={visibleError("currentWorkaround")}>
          <Textarea id="currentWorkaround" name="currentWorkaround" rows={2} value={values.currentWorkaround} onChange={(e) => update("currentWorkaround", e.target.value)} onBlur={() => blur("currentWorkaround")} aria-describedby={describedBy("currentWorkaround")} />
        </Field>
      </Section>

      <Section title="Impact" description="Help product owners weigh this against other demand. Estimates are fine.">
        <Field id="businessImpact" label="Business impact" required hint="Who is affected, how often, and the cost of the status quo (calls, time, risk, retention)." error={visibleError("businessImpact")}>
          <Textarea id="businessImpact" name="businessImpact" rows={3} value={values.businessImpact} onChange={(e) => update("businessImpact", e.target.value)} onBlur={() => blur("businessImpact")} aria-invalid={Boolean(visibleError("businessImpact"))} aria-describedby={describedBy("businessImpact")} />
        </Field>
        <Field id="expectedBenefit" label="Expected benefit" hint="What improves if this is delivered." error={visibleError("expectedBenefit")}>
          <Textarea id="expectedBenefit" name="expectedBenefit" rows={2} value={values.expectedBenefit} onChange={(e) => update("expectedBenefit", e.target.value)} onBlur={() => blur("expectedBenefit")} aria-describedby={describedBy("expectedBenefit")} />
        </Field>
        <Field id="tags" label="Tags" hint="Press Enter or comma to add. Up to 8 short tags, such as “transfers” or “accessibility”." error={visibleError("tags")}>
          <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
            {values.tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded-[4px] bg-muted px-2 py-0.5 text-[12px]">
                #{tag}
                <button type="button" aria-label={`Remove ${tag}`} onClick={() => update("tags", values.tags.filter((t) => t !== tag))} className="text-muted-foreground hover:text-foreground">
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <input
              id="tags"
              name="tags"
              value={tagDraft}
              onChange={(e) => (e.target.value.endsWith(",") ? addTag(e.target.value) : setTagDraft(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(tagDraft);
                } else if (e.key === "Backspace" && !tagDraft && values.tags.length) {
                  update("tags", values.tags.slice(0, -1));
                }
              }}
              onBlur={() => addTag(tagDraft)}
              className="min-w-[140px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder={values.tags.length ? "" : "Add tags…"}
              aria-describedby={describedBy("tags")}
            />
          </div>
        </Field>
      </Section>

      <div className="sticky bottom-0 -mx-6 flex flex-col-reverse gap-3 border-t border-border bg-card/95 px-6 py-4 backdrop-blur sm:-mx-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Info className="size-3.5" />
          {autoQueue
            ? "Automatic queueing is on: this request will be sent to automation when submitted."
            : "New requests start as New and are not sent to automation until someone queues them."}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" asChild>
            <Link href="/requests">Cancel</Link>
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="animate-spin" />}
            {submitting ? "Submitting…" : "Submit feedback"}
          </Button>
        </div>
      </div>
    </form>
  );
}
