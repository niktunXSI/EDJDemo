import { cn } from "@/lib/utils";

export function Wordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col leading-none", className)}>
      <span className="font-serif text-[19px] font-semibold tracking-[-0.01em] text-[#fbf9f3]">Edward Jones</span>
      {!compact && (
        <span className="mt-1.5 flex items-center gap-2 whitespace-nowrap text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[#d8c393]">
          <span aria-hidden className="h-px w-4 bg-[#b38b3d]" />
          Client Product Insights
        </span>
      )}
    </div>
  );
}
