"use client";

import { Download } from "lucide-react";
import { track } from "@/app/_lib/analytics/track";

// The Analytics tab's ONE export affordance.
//
// The class string below had been typed out four times across the tab (the roles
// table, the decision log's page and whole-trail buttons, the record dossier), and
// the two surfaces this change adds — the funnel band and the acquisition board —
// would have made six. Six copies is how a hover state or a disabled state drifts
// between panels that are meant to read as one page.
//
// `print:hidden` is part of the affordance, not decoration: a printed brief cannot
// be clicked, so a button on it is furniture.
export function AnalyticsExportButton({
  label,
  onClick,
  disabled,
  title,
  artifact,
}: {
  label: string;
  onClick: () => void;
  /** Disabled whenever there are no rows to write — a file with a header and
   *  nothing under it is worse than no download, because it reads as "we measured
   *  nothing" rather than "there was nothing to measure". */
  disabled?: boolean;
  title?: string;
  /** Stable filename/id for the cookieless `analytics_export` event. Falls back
   *  to `"file"` so a caller that has not named the artifact still fires. */
  artifact?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        track("analytics_export", { artifact: artifact ?? "file" });
        onClick();
      }}
      disabled={disabled}
      title={title}
      className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-sm font-medium text-steel hover:bg-paper hover:text-ink disabled:opacity-50 print:hidden"
    >
      <Download size={12} aria-hidden /> {label}
    </button>
  );
}
