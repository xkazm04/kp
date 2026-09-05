"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { AnalyticsStatCluster } from "./AnalyticsStatCluster";
import { AnalyticsCopyViewLink } from "./AnalyticsCopyViewLink";
import type { AnalyticsSectionId } from "./sections/analyticsSections";
import { WINDOW_CHOICES, type Analytics } from "./AnalyticsTypes";

import { LoadingGap } from "@/app/_components/ui/LoadingGap";
// The tab's header: eyebrow/title/intro, the cohort-window switcher, and the
// key-stat cluster. Split out of AnalyticsTab.tsx to keep that file under the
// 200-line cap.

// UAT KAT-ANA-5 (×2, convergent with TOM-ANA-13) — the sections this switcher
// CANNOT reach. Per G9 the four headline numbers and the switcher stay in the
// always-rendered header, above the section nav; the consequence was a control
// pressed to "Last 30 days" sitting above a whole section (calibration, score
// bands, threshold history, both audit tables) that reads no `days` param at
// all. Windowing the audit trail itself is declined (G4/§2.23 — an auditor's
// chain is not a view), so the honest fix is for the control to state its reach
// rather than imply one it doesn't have.
const WINDOW_BLIND_SECTIONS: readonly AnalyticsSectionId[] = ["quality"];

export function AnalyticsHeader({
  data,
  error,
  days,
  setDays,
  section,
}: {
  data: Analytics | null;
  error: string | null;
  days: number | null;
  setDays: (w: number | null) => void;
  /** The section on screen, so the switcher can say when it governs nothing
   *  below it. Optional: omitted, the control describes its overall reach. */
  section?: AnalyticsSectionId;
}) {
  const t = useTranslations("analytics");
  const scopeNoteId = useId();
  const windowApplies = section == null || !WINDOW_BLIND_SECTIONS.includes(section);
  // One line, three truths — the note is the switcher's accessible description
  // (aria-describedby), so the scope in force is announced WITH the control and
  // not just painted beside it:
  //  · this section ignores the window entirely (Quality & audit);
  //  · a window is in force, and here is what it does not cover;
  //  · all-time is selected, which is why no delta chips render — the state
  //    TOM-ANA-7 (×2) found unexplained anywhere on the page. `deltas` is null
  //    by design for all time (api/analytics/route.ts), so DeltaChip returns
  //    null and its `title` ("vs the previous period…") never reaches a reader.
  const scopeNote = !windowApplies ? t("windowScopeBlind") : days == null ? t("windowDeltaHint") : t("windowScopeReach");
  return (
    <header className="flex flex-col gap-5 border-b border-stone-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h2 className="mt-1 font-serif text-display text-ink">{t("title")}</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">{t("intro")}</p>
        {/* ANA2: cohort window — the windowed figures scope to entries created in
            the period (all-time stays the default). "Every figure below", as this
            comment used to claim, was never true: Quality & audit and the company
            benchmark read no window at all, which is what the note beneath the
            pills now says out loud (UAT KAT-ANA-5). */}
        <div
          className={`mt-3 flex flex-wrap items-center gap-2 transition-opacity ${windowApplies ? "" : "opacity-50"}`}
          role="group"
          aria-label={t("windowLabel")}
          aria-describedby={scopeNoteId}
        >
          {WINDOW_CHOICES.map((w) => (
            <button
              key={w ?? "all"}
              type="button"
              onClick={() => setDays(w)}
              aria-pressed={days === w}
              className={`focus-ring rounded-full border px-3 py-1 text-sm font-semibold transition-colors ${
                days === w ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:border-coral/40"
              }`}
            >
              {w == null ? t("windowAll") : t("windowDays", { days: w })}
            </button>
          ))}
        </div>
        {/* Greyed rather than disabled: the choice still governs Performance and
            Economics, so taking it away would strand a reader who arrived on
            ?sec=quality. Muted + a stated scope tells the truth without
            confiscating the control. */}
        <p id={scopeNoteId} className="mt-2 max-w-3xl text-meta text-steel">
          {scopeNote}
        </p>
        {/* WHICH CLOCK the window and the trend buckets are cut on. Every cutoff
            in db/analytics.ts is ISO/millisecond arithmetic, so "the last 30 days"
            and every weekly momentum bar end at a UTC midnight — one or two hours
            before a Prague operator's own day does. Small, real, and invisible
            while nothing said which zone the page counts in. The payload declares
            it (`bucketTz`); this states it where the control that uses it lives. */}
        <p className="mt-1 max-w-3xl text-meta text-steel">{t("bucketTzNote")}</p>
        {/* THE SILENCE, NAMED. Every figure on this page excludes guided-demo rows
            (db/analytics.ts `notSim`) — correctly, since a demo must never move a
            leadership metric. But the board shows those same people, so after a
            guided run the funnel and the board disagreed with nothing on screen to
            explain it. The server counts what it dropped; this says so, and only
            when there is something to say. A count, never a link to the rows: they
            are demo residue, and `resetSim` is where they go. */}
        {data && (data.excludedSim ?? 0) > 0 ? (
          <p className="mt-1 max-w-3xl text-meta text-steel">{t("simExcludedNote", { count: data.excludedSim ?? 0 })}</p>
        ) : null}
        {/* The two ways to take this view somewhere else. UAT TOM-ANA-8 put the
            second one here: the reader who came to settle an argument needs the file
            OR the link, and both belong above the section they describe rather than
            at the bottom of a scroll. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* W0.4 — the metric pack. The four numbers a buyer asks for (time-to-hire,
              cost-per-hire, recruiter hours saved, roles per recruiter) as one page, each
              carrying its sample and whether it is publishable. A plain link, not a fetch:
              the route streams the Markdown as a download. */}
          <a
            href={`/api/analytics/metric-pack?format=md${days ? `&days=${days}` : ""}`}
            className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-3 py-1 text-sm font-semibold text-steel transition-colors hover:border-coral/40 hover:text-coral"
          >
            {t("metricPackDownload")}
          </a>
          {/* UAT TOM-ANA-8 — a view link needs a view to name. `section` is optional on
              this header (a caller may render it without one), and minting a link to the
              DEFAULT section instead would hand the reader a URL that lands somewhere
              else — the defect one layer down. No section, no link. */}
          {section ? <AnalyticsCopyViewLink section={section} days={days} /> : null}
        </div>
      </div>

      {/* Tier 2: nested inside the (always-rendering) header — quiet reserved
          box while the fetch is in flight, then the real figures fade in place. */}
      {!data && !error ? (
        <LoadingGap className="min-h-[6rem] shrink-0 lg:w-[22rem]" />
      ) : data ? (
        <AnalyticsStatCluster data={data} />
      ) : null}
    </header>
  );
}
