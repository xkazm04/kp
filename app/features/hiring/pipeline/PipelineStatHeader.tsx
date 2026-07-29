"use client";

// The pipeline tab's page header: eyebrow/title/intro plus the compact stat-chip
// cluster (positions / active / interview / aging / needs-intake / awaiting-you).
// Split out of PipelineTab.tsx — pure display, driven entirely by props.

import type { PipelineTabTranslator } from "./pipelineTranslator";
import { EYEBROW, INTRO, PAGE_HEADER, STAT, STAT_LABEL, STAT_VALUE, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import type { Entry, Position } from "@/app/features/shared/pipelineTypes";

// Compact header stat: label over value, optionally clickable. Replaces the old
// full-width Kpi card grid — the same numbers now live as a tight cluster in the
// page's top-right corner so the board gets the vertical space.
function StatChip({
  label,
  value,
  tone = "neutral",
  onClick,
}: {
  label: string;
  value: number;
  tone?: "neutral" | "coral" | "amber" | "red";
  onClick?: () => void;
}) {
  const valueColor =
    tone === "coral" ? "text-coral" : tone === "amber" ? "text-amber-700" : tone === "red" ? "text-red-700" : "text-ink";
  const cls = `${STAT} min-w-[5rem] items-center px-3 py-2`;
  const inner = (
    <>
      <span className={`${STAT_LABEL} text-center`}>{label}</span>
      <span className={`${STAT_VALUE} ${valueColor}`}>{value}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} focus-ring transition-colors hover:border-coral/50`}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function PipelineStatHeader({
  t,
  entries,
  positions,
  activeCount,
  interviewCount,
  staleCount,
  degradedCount,
  approvals,
  onToggleAging,
  onFocusDegraded,
  onGoToDecisions,
}: {
  t: PipelineTabTranslator;
  entries: Entry[] | null;
  positions: Position[];
  activeCount: number;
  interviewCount: number;
  staleCount: number;
  degradedCount: number;
  approvals: Entry[];
  onToggleAging: () => void;
  onFocusDegraded: () => void;
  onGoToDecisions: () => void;
}) {
  return (
    <header className={PAGE_HEADER}>
      <div>
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <h2 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h2>
        <p className={`mt-2 max-w-2xl ${INTRO}`}>{t("intro")}</p>
      </div>
      {entries && entries.length > 0 ? (
        <div className="flex flex-wrap items-stretch gap-1.5">
          <StatChip label={t("statPositions")} value={positions.length} />
          <StatChip label={t("statActive")} value={activeCount} />
          <StatChip label={t("statInterview")} value={interviewCount} />
          <StatChip
            label={t("statAging")}
            value={staleCount}
            tone={staleCount > 0 ? "amber" : "neutral"}
            onClick={staleCount > 0 ? onToggleAging : undefined}
          />
          {degradedCount > 0 ? (
            <StatChip label={t("statNeedsIntake")} value={degradedCount} tone="red" onClick={onFocusDegraded} />
          ) : null}
          <StatChip
            label={t("statAwaitingYou")}
            value={approvals.length}
            tone={approvals.length > 0 ? "coral" : "neutral"}
            onClick={onGoToDecisions}
          />
        </div>
      ) : null}
    </header>
  );
}
