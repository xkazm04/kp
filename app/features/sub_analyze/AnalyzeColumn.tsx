"use client";

import { X } from "lucide-react";
import type { ColumnStatus } from "./AnalyzeTypes";

export function AnalyzeColumn({
  icon,
  heading,
  status,
  onClear,
  children,
}: {
  icon: React.ReactNode;
  heading: string;
  status: ColumnStatus;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  const toneClass =
    status.tone === "required"
      ? "bg-coral/10 text-coral"
      : status.tone === "attached"
        ? "bg-moss/15 text-ink"
        : "bg-paper text-steel";
  return (
    <div className="flex flex-col rounded-lg border border-stone-200 bg-paper p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold text-ink">{heading}</h3>
        </div>
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-stone-300 bg-white px-2 text-[11px] font-semibold text-ink hover:bg-stone-50"
            title="Clear"
          >
            <X className="h-3 w-3" aria-hidden />
            Clear
          </button>
        ) : null}
      </div>
      <p
        className={`mt-2 inline-block max-w-full truncate rounded-full px-2 py-0.5 text-xs font-medium ${toneClass}`}
        title={status.label}
      >
        {status.label}
      </p>
      {/* flex-1 stretches the children container to fill the column so any
          child marked with `mt-auto` (typically the PasteRow) anchors to the
          card bottom — keeping the paste UI vertically aligned across the
          Job / Company / GitHub columns regardless of how many siblings sit
          above it. */}
      <div className="mt-3 flex flex-1 flex-col gap-3">{children}</div>
    </div>
  );
}
