const SEGMENT_STYLES: Record<string, string> = {
  Emerging: "bg-[#eef3f8] text-[#2b4766]",
  Established: "bg-[#e1ede6] text-[#1d4a37]",
  Preferred: "bg-[#f6ecd3] text-[#6a4c0f]",
  "Private Client": "bg-[#1d4a37] text-[#f7f4ea]",
};

export function SegmentPill({ segment }: { segment: string }) {
  return <span className={`inline-flex rounded-[4px] px-2 py-0.5 text-xs font-medium ${SEGMENT_STYLES[segment] ?? "bg-muted"}`}>{segment}</span>;
}
