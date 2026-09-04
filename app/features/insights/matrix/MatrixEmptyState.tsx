"use client";

/**
 * Matrix first-run empty state.
 *
 * Metaphor: the empty grid as a diagram of its own two axes. You don't "go
 * somewhere to fix an error" — you fill a side, and the grid computes itself. The
 * two upstream links the chain-aware empty state has always carried (see
 * app/_components/ChainEmptyState.tsx) are re-framed as the grid's rows
 * (candidates) and columns (open roles), each showing the real count that would
 * fill it.
 *
 * The glyph is the /motionize traced MATRIX_GLYPH (candidates x roles, cells
 * filling with signal). Every fill resolves through the brand-token snap in
 * MotionizedGlyph — no hex reaches this file.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, Columns3, Rows3 } from "lucide-react";
import { MotionizedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { GLYPH_SIZE } from "@/app/_components/glyph/glyphSizes";
import { MATRIX_GLYPH } from "@/app/_components/glyph/glyphs/matrixGlyph";
import { PANEL, PANEL_SUNKEN, EYEBROW, TITLE_DISPLAY, INTRO, CARD_PAD } from "@/app/_components/ui/recipes";
import { buildTabSwitchUrl, type WorkspaceTabId } from "@/app/features/shell/tabs";

export type MatrixEmptyStateProps = {
  /** Real counts from the computed matrix — which axis is actually missing. */
  candidateCount: number;
  positionCount: number;
};

/** One upstream hop in the hiring chain, with the count that would fill it. */
type Axis = {
  tab: WorkspaceTabId;
  /** "Rows" / "Columns" — which side of the grid this input becomes. */
  axisLabel: string;
  noun: string;
  count: number;
  linkLabel: string;
  /** Localized "None yet…" / "N ready to plot." line for this side. */
  countLine: string;
  icon: typeof Rows3;
};

/**
 * Navigate to an upstream tab exactly the way ChainEmptyState does — through
 * buildTabSwitchUrl, so the destination opens clean.
 */
function useChainNav() {
  const router = useRouter();
  const search = useSearchParams();
  return (tab: WorkspaceTabId) => router.push(buildTabSwitchUrl(tab, search.toString()));
}

function ChainLink({ tab, label }: { tab: WorkspaceTabId; label: string }) {
  const go = useChainNav();
  return (
    <button
      type="button"
      onClick={() => go(tab)}
      className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-coral hover:underline"
    >
      {label} <ArrowRight size={13} aria-hidden />
    </button>
  );
}

/** The two inputs the grid multiplies together, in chain order. */
function useAxes({ candidateCount, positionCount }: MatrixEmptyStateProps): Axis[] {
  const t = useTranslations("matrix");
  // One key per axis rather than one shared "{count} ready to plot": the counted
  // noun is a candidate on one side and a role on the other, and the inflected
  // locales agree the participle with it (cs/fr gender, de invariant).
  const countLine = (count: number, readyKey: "emptyAxisReadyCandidates" | "emptyAxisReadyRoles") =>
    count === 0 ? t("emptyAxisNone") : t(readyKey, { count });
  return [
    {
      tab: "pipeline",
      axisLabel: t("emptyAxisRows"),
      noun: t("emptyAxisCandidates"),
      count: candidateCount,
      linkLabel: t("emptyGridCtaPipeline"),
      countLine: countLine(candidateCount, "emptyAxisReadyCandidates"),
      icon: Rows3,
    },
    {
      tab: "jobs",
      axisLabel: t("emptyAxisColumns"),
      noun: t("emptyAxisRoles"),
      count: positionCount,
      linkLabel: t("emptyGridCtaJobs"),
      countLine: countLine(positionCount, "emptyAxisReadyRoles"),
      icon: Columns3,
    },
  ];
}

/** One axis of the not-yet-computed grid, presented as a fillable side. */
function AxisCard({ axis }: { axis: Axis }) {
  const Icon = axis.icon;
  return (
    <div className={`${PANEL} ${CARD_PAD} text-left`}>
      <p className={EYEBROW}>{axis.axisLabel}</p>
      <p className="mt-1 flex items-center gap-2 text-base font-semibold text-ink">
        <Icon size={16} className="shrink-0 text-steel" aria-hidden />
        {axis.noun}
      </p>
      <p className="mt-1 text-sm text-steel">{axis.countLine}</p>
      <div className="mt-3">
        <ChainLink tab={axis.tab} label={axis.linkLabel} />
      </div>
    </div>
  );
}

export function MatrixEmptyState(props: MatrixEmptyStateProps) {
  const t = useTranslations("matrix");
  const axes = useAxes(props);
  return (
    <div className={`${PANEL_SUNKEN} p-8 text-center`}>
      <MotionizedGlyph
        data={MATRIX_GLYPH.data}
        viewBox={MATRIX_GLYPH.viewBox}
        className={`mx-auto ${GLYPH_SIZE.xl}`}
        entrance="staggered-draw"
        ambient="float"
      />
      <p className={`${EYEBROW} mt-4`}>{t("title")}</p>
      <h3 className={`${TITLE_DISPLAY} mt-1`}>{t("emptyAxesTitle")}</h3>
      <p className={`${INTRO} mx-auto mt-2 max-w-lg`}>{t("emptyAxesBody")}</p>
      <div className="mx-auto mt-6 grid max-w-2xl gap-3 sm:grid-cols-2">
        {axes.map((axis) => (
          <AxisCard key={axis.tab} axis={axis} />
        ))}
      </div>
    </div>
  );
}
