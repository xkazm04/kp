"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ColumnStatus } from "./AnalyzeTypes";

export function AnalyzeColumn({
  icon,
  heading,
  status,
  required = false,
  onClear,
  children,
}: {
  icon: React.ReactNode;
  heading: string;
  status: ColumnStatus;
  required?: boolean;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("analyze");
  return (
    <div
      className={`flex flex-col rounded-lg border border-stone-200 bg-paper p-3 ${
        required ? "border-l-2 border-l-coral" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {icon}
          <h3 className="text-base font-semibold text-ink">{heading}</h3>
          {/* Persistent requirement-level tag so the asymmetric rules (only CV
              is required) read at a glance, independent of attachment state.
              It wraps below the heading on tight columns rather than truncating
              the heading. */}
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${
              required ? "bg-coral/10 text-coral" : "bg-stone-100 text-steel"
            }`}
          >
            {required ? t("required") : t("optional")}
          </span>
        </div>
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-stone-300 bg-white px-2 text-sm font-semibold text-ink hover:bg-stone-50"
            title={t("clear")}
          >
            <X className="h-3 w-3" aria-hidden />
            {t("clear")}
          </button>
        ) : null}
      </div>
      {/* Once something is attached, show its identity (filename / size). The
          empty "Required"/"Optional" state is already conveyed by the header
          tag above, so we skip a redundant pill here. */}
      {status.tone === "attached" ? (
        <p
          className="mt-2 inline-block max-w-full truncate rounded-full bg-moss/15 px-2 py-0.5 text-sm font-medium text-ink"
          title={status.label}
        >
          {status.label}
        </p>
      ) : null}
      {/* flex-1 stretches the children container to fill the column so any
          child marked with `mt-auto` (typically the PasteRow) anchors to the
          card bottom — keeping the paste UI vertically aligned across the
          Job / Company / GitHub columns regardless of how many siblings sit
          above it. */}
      <div className="mt-3 flex flex-1 flex-col gap-3">{children}</div>
    </div>
  );
}
