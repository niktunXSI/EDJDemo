"use client";

import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Download, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AUTOMATION_LABELS,
  AUTOMATION_STATUSES,
  PRIORITIES,
  PRIORITY_LABELS,
  PRODUCT_AREAS,
  PRODUCT_AREA_LABELS,
  REQUEST_STATUSES,
  REQUEST_TYPES,
  STATUS_LABELS,
  TYPE_LABELS,
} from "@/lib/domain";
import { cn } from "@/lib/utils";

interface FilterDef {
  key: string;
  label: string;
  options: readonly string[];
  labels: Record<string, string>;
}

const FILTERS: FilterDef[] = [
  { key: "status", label: "Status", options: REQUEST_STATUSES, labels: STATUS_LABELS },
  { key: "priority", label: "Priority", options: PRIORITIES, labels: PRIORITY_LABELS },
  { key: "productArea", label: "Product area", options: PRODUCT_AREAS, labels: PRODUCT_AREA_LABELS },
  { key: "requestType", label: "Request type", options: REQUEST_TYPES, labels: TYPE_LABELS },
  { key: "automationStatus", label: "Automation", options: AUTOMATION_STATUSES, labels: AUTOMATION_LABELS },
];

function selected(params: URLSearchParams, key: string) {
  return params
    .getAll(key)
    .flatMap((v) => v.split(","))
    .filter(Boolean);
}

export function RequestFilters({ total }: { total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function navigate(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    next.delete("page");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  const urlQuery = params.get("q") ?? "";
  const [syncedQuery, setSyncedQuery] = useState(urlQuery);
  if (urlQuery !== syncedQuery) {
    setSyncedQuery(urlQuery);
    setQuery(urlQuery);
  }

  function onSearch(value: string) {
    setQuery(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      navigate((next) => (value.trim() ? next.set("q", value.trim()) : next.delete("q")));
    }, 300);
  }

  function toggle(key: string, value: string) {
    navigate((next) => {
      const current = selected(next, key);
      const updated = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      next.delete(key);
      if (updated.length) next.set(key, updated.join(","));
    });
  }

  const activeCount = FILTERS.reduce((n, f) => n + selected(params, f.key).length, 0) + (params.get("q") ? 1 : 0);
  const exportParams = new URLSearchParams(params.toString());
  exportParams.delete("page");
  exportParams.delete("pageSize");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative lg:w-[340px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search titles, feedback, clients, advisors…"
            className="bg-card pl-8"
            aria-label="Search requests"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((filter) => {
            const values = selected(params, filter.key);
            return (
              <Popover key={filter.key}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn("h-9 bg-card font-normal", values.length > 0 && "border-[#1d4a37]/40 bg-[#eef4f0] text-[#1d4a37]")}
                  >
                    {filter.label}
                    {values.length > 0 && (
                      <span className="rounded-[3px] bg-[#1d4a37] px-1.5 text-[11px] font-semibold text-white">{values.length}</span>
                    )}
                    <ChevronDown className="size-3.5 opacity-60" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-60 p-1.5">
                  <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{filter.label}</p>
                  <ul>
                    {filter.options.map((option) => {
                      const id = `f-${filter.key}-${option}`;
                      return (
                        <li key={option}>
                          <label htmlFor={id} className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-[13px] hover:bg-muted">
                            <Checkbox id={id} checked={values.includes(option)} onCheckedChange={() => toggle(filter.key, option)} />
                            {filter.labels[option]}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  {values.length > 0 && (
                    <button
                      type="button"
                      className="mt-1 w-full rounded px-2 py-1.5 text-left text-[12.5px] text-muted-foreground hover:bg-muted"
                      onClick={() => navigate((next) => next.delete(filter.key))}
                    >
                      Clear {filter.label.toLowerCase()}
                    </button>
                  )}
                </PopoverContent>
              </Popover>
            );
          })}
          {activeCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-muted-foreground"
              onClick={() => {
                setQuery("");
                navigate((next) => {
                  ["q", ...FILTERS.map((f) => f.key)].forEach((k) => next.delete(k));
                });
              }}
            >
              <X /> Clear all
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3 lg:ml-auto">
          <span className="text-[12.5px] text-muted-foreground" aria-live="polite">
            {pending ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" /> Updating…
              </span>
            ) : (
              `${total.toLocaleString("en-US")} result${total === 1 ? "" : "s"}`
            )}
          </span>
          <Button variant="outline" size="sm" className="h-9 bg-card" asChild>
            <a href={`/api/requests/export?${exportParams.toString()}`} download>
              <Download /> Export CSV
            </a>
          </Button>
        </div>
      </div>
      {activeCount > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {params.get("q") && (
            <Chip label={`Search: “${params.get("q")}”`} onRemove={() => (setQuery(""), navigate((next) => next.delete("q")))} />
          )}
          {FILTERS.flatMap((filter) =>
            selected(params, filter.key).map((value) => (
              <Chip
                key={`${filter.key}-${value}`}
                label={`${filter.label}: ${filter.labels[value] ?? value}`}
                onRemove={() => toggle(filter.key, value)}
              />
            )),
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-0.5 pl-2.5 pr-1 text-[12px] text-foreground">
      {label}
      <button type="button" onClick={onRemove} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Remove ${label}`}>
        <X className="size-3" />
      </button>
    </span>
  );
}
