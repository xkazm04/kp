"use client";

import { useTranslations } from "next-intl";
import { MotionizedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { ANALYTICS_GLYPH } from "@/app/_components/glyph/glyphs/analyticsGlyph";
import { META_LABEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { UpstreamLinks, type AnalyticsEmptyLink } from "./AnalyticsEmptyShared";
import { stageQuestionKey, type FunnelRow } from "./analyticsFunnelEmptyState";

// VARIANT B — "the questions this funnel is standing by to answer".
//
// Metaphor: not a chart at rest but a READING GUIDE. It abandons the bar
// geometry entirely and treats the stage axis as an ordered list of questions —
// each stage is a decision the recruiter will get to make once a candidate
// first crosses into it. Where variant A teaches the *shape* of the
// measurement, B teaches its *meaning*, which is the thing a first-time user
// of an analytics tab actually lacks.
//
// This deliberately mirrors round 1's rhetorical move on this same tab
// (`AnalyticsEmptyPreview` — "what this tab will report", three metrics, three
// em-dashes) and applies it one level down, to the funnel's own axis. Sharing
// the vocabulary is the point: if both ever showed at once they would read as
// one voice — though they cannot, since round 1 fires only when no entry has
// ever existed and this fires only when entries exist but have not moved.
//
// Honesty: every stage carries a literal em-dash where its number will go. No
// sample percentage, no illustrative bar, no greyed-out "example" chart.
//
// Motion: the glyph's default `staggered-draw` entrance only. No ambient loop —
// an idle empty state must not imply work in progress.

type Props = {
  funnel: FunnelRow[];
  stageLabel: (stage: string) => string;
  links: AnalyticsEmptyLink[];
};

export function FunnelEmptyGuide({ funnel, stageLabel, links }: Props) {
  const t = useTranslations("analytics.funnelGuide");
  const [entry, ...waiting] = funnel;

  return (
    <div className={`${PANEL_SUNKEN} mt-4 p-5`}>
      <div className="flex items-start gap-4">
        <MotionizedGlyph
          data={ANALYTICS_GLYPH.data}
          viewBox={ANALYTICS_GLYPH.viewBox}
          className="hidden h-24 w-24 shrink-0 sm:block"
        />
        <div className="min-w-0">
          <p className="text-base font-semibold text-ink">{t("title")}</p>
          <p className="mt-1 max-w-xl text-sm text-steel">{t("body", { count: entry.reached })}</p>
        </div>
      </div>

      <p className={`mt-5 ${META_LABEL}`}>{t("stepsLabel")}</p>
      {/* Hairline dividers via the tab's existing gap-px idiom: the list's own
          background shows through the 1px gaps between white rows. */}
      <ol className="mt-2 space-y-px overflow-hidden rounded-md border border-stone-200 bg-stone-200">
        {funnel.map((f) => {
          // The first stage is the only one with a real figure behind it; every
          // other row shows an em-dash rather than a manufactured zero.
          const live = f.stage === entry.stage;
          return (
            <li key={f.stage} className="flex items-baseline gap-3 bg-white px-3 py-2.5">
              <span className="w-28 shrink-0 text-base font-medium text-ink">{stageLabel(f.stage)}</span>
              <span className="min-w-0 flex-1 text-sm text-steel">{t(stageQuestionKey(f.stage))}</span>
              {live ? (
                <span className="shrink-0 text-sm font-semibold text-ink nums">{f.reached}</span>
              ) : (
                <span className="shrink-0 text-sm text-stone-400" aria-label={t("noDataYet")}>
                  —
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {waiting.length > 0 ? (
        <p className="mt-2 text-sm text-steel">{t("waiting", { count: waiting.length })}</p>
      ) : null}

      <UpstreamLinks links={links} className="mt-4" />
    </div>
  );
}
