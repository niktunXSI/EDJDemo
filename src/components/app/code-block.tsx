"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
      aria-label={label}
    >
      {copied ? <Check className="size-3.5 text-[#1f5c3b]" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function CodeBlock({ code, title, className }: { code: string; title?: string; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-md border border-[#22332b] bg-[#14231c]", className)}>
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="text-[11.5px] font-medium text-[#a9bdb2]">{title ?? ""}</span>
        <CopyButton value={code} className="text-[#a9bdb2] hover:bg-white/10 hover:text-white" />
      </div>
      <pre className="max-h-[440px] overflow-auto px-4 py-3 font-mono text-[12px] leading-relaxed text-[#e6efe9]">
        <code>{code}</code>
      </pre>
    </div>
  );
}
