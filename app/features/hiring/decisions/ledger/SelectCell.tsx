"use client";

// The decisions board's batch checkbox: a row either joins a batch (offers never do: each sets its
// own deadline and secure link) or leaves a gap of the same width.
import { CheckSquare, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_GHOST } from "@/app/_components/ui/recipes";
import type { LedgerRow } from "./decisionsLedgerModel";

export function SelectCell({ row, selected, onToggle }: { row: LedgerRow; selected: boolean; onToggle?: () => void }) {
  const t = useTranslations("decisions.aiReview");
  if (!onToggle) return <span className="inline-block w-4" aria-hidden />;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={t("select", { name: row.entry.candidateLabel })}
      onClick={onToggle}
      className={`${BTN_GHOST} cursor-pointer p-0.5`}
    >
      {selected ? <CheckSquare size={15} className="text-coral" aria-hidden /> : <Square size={15} className="text-steel" aria-hidden />}
    </button>
  );
}
