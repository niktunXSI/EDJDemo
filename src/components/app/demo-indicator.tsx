import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

export function DemoIndicator({ className, tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
        tone === "light"
          ? "border border-[#e5d3a4] bg-[#fbf5e6] text-[#6a4c0f]"
          : "border border-white/10 bg-white/[0.04] text-[#d8c393]",
        className,
      )}
    >
      <FlaskConical aria-hidden className="size-3" />
      Demo environment • Synthetic client data
    </span>
  );
}
