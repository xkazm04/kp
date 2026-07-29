"use client";

import { SquarePen } from "lucide-react";

// The per-recommendation "stage this edit" affordance. Rendered only for a JD-backed
// role (a slug to edit); the click deep-links into the Library ledger's JD editor
// with the change staged (CoachPanel.stageEdit). Sits beside the "+N" badge and
// wraps below on a narrow row. Extracted verbatim from JobsCoachPanel.tsx.
export function StageEditButton({
  show,
  label,
  ariaLabel,
  onClick,
}: {
  show: boolean;
  label: string;
  ariaLabel: string;
  onClick: () => void;
}) {
  if (!show) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-sm font-semibold text-steel transition-colors hover:border-coral/40 hover:text-coral"
    >
      <SquarePen size={13} aria-hidden /> {label}
    </button>
  );
}
