"use client";

// The pipeline tab's page header: eyebrow/title/intro plus the compact stat-chip
// cluster (positions / active / interview / aging / needs-intake / awaiting-you).
// Split out of PipelineTab.tsx — pure display, driven entirely by props.

import type { PipelineTabTranslator } from "./pipelineTranslator";
import { EYEBROW, INTRO, STAT, STAT_LABEL, STAT_VALUE, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { Fade } from "./PipelineMotion";
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
    // Two rows, not the PAGE_HEADER two-column split: the title and the stat
    // cluster share the FIRST row (they're both "what is this board, at a
    // glance"), and the intro gets the full second row instead of being squeezed
    // into a max-w-2xl column beside the chips. Same ruled-off, generously spaced
    // header shape as PAGE_HEADER — only the internal axis differs.
    <header className="border-b border-stone-200 pb-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <p className={EYEBROW}>{t("eyebrow")}</p>
          <h2 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h2>
        </div>
        {/* Fades in when the board fetch lands rather than popping into the row. */}
        <Fade show={Boolean(entries && entries.length > 0)}>
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
        </Fade>
      </div>
      <p className={`mt-3 ${INTRO}`}>{t("intro")}</p>
    </header>
  );
}
