"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { OfferConversion } from "@/app/_lib/analytics-offer";
import { SectionTitle } from "@/app/_components/ui/SectionTitle";
import { EYEBROW } from "@/app/_components/ui/recipes";
import { OfferLegPanel } from "./AnalyticsOfferLegPanel";
import type { Analytics } from "./AnalyticsTypes";

// UAT KAT-ANA-3 / TOM-ANA-2 — the home for three payload fields the server computed
// on every request and nobody rendered. They were not lost in a refactor of their own:
// they were the parts of the deleted AnalyticsFunnelPanel that the consolidated funnel
// band does NOT carry, and a consolidation that keeps the machinery and drops the
// wiring is the defect this whole item exists to stop recurring.
//
// Tomáš named `stageDwell` the one that stings: „Čas v jednotlivých fázích" is the
// literal, per-stage answer to „proč je moje pozice pořád otevřená", and the brief
// answered it nowhere. So this band is the funnel's three missing edges, in the order
// a reader meets them:
//   • before the first stage — the KO-gate discards that never mint an entry at all;
//   • inside the stages — how long the people sitting there have been sitting;
//   • after the last one — the offer leg, extended → accepted / declined / expired.
//
// It renders the briefing's OWN band shape (eyebrow, claim in display type, context,
// then the evidence) rather than a card, so it reads as part of the brief and the
// section only has to place it — the `Band` helper is local to PerformanceBriefing,
// so the three lines of its markup are mirrored here deliberately.
export function StageDwellPanel({
  stageDwell,
  koDeclined,
  offers,
  offerStage,
  enumLabel,
  boardHref,
}: {
  stageDwell: Analytics["stageDwell"];
  /** Applicants the eligibility gate turned away BEFORE the funnel's first stage. */
  koDeclined: number;
  offers: OfferConversion;
  /** The workspace’s own offer column, forwarded to the offer panel’s board link. */
  offerStage: string | null;
  enumLabel: (kind: string, value: string) => string;
  boardHref: (filter: { q?: string; stage?: string }) => string;
}) {
  const t = useTranslations("analytics");

  // Nothing measured anywhere: the funnel band above already carries the brief's one
  // „not yet" (briefNoDataClaim / the zero-transition guide), and a second refusal in
  // the same voice two inches below it is just louder, not more honest. Below at least
  // one of the three edges has something to report, so the band earns its rule.
  if (stageDwell.length === 0 && koDeclined === 0 && offers.extended === 0) return null;

  const waiting = stageDwell.reduce((sum, s) => sum + s.count, 0);
  const maxDays = Math.max(1, ...stageDwell.map((s) => s.avgDays));

  return (
    <section className="border-t border-stone-200 pt-6">
      <p className={EYEBROW}>{t("briefBandDwell")}</p>
      <SectionTitle className="mt-1 text-balance !text-h1">
        {stageDwell.length === 0 ? t("briefDwellNoneClaim") : t("briefDwellClaim", { count: waiting })}
      </SectionTitle>
      {stageDwell.length > 0 ? (
        <p className="mt-3 max-w-2xl text-body leading-relaxed text-steel">{t("briefDwellContext")}</p>
      ) : null}

      {stageDwell.length > 0 ? (
        <ul className="mt-5 max-w-3xl space-y-2">
          {stageDwell.map((s) => (
            <li key={s.stage}>
              <Link
                href={boardHref({ stage: s.stage })}
                title={t("viewInBoard")}
                className="focus-ring -mx-1.5 flex items-center gap-4 rounded-md px-1.5 py-1 hover:bg-paper/70"
              >
                <span className="w-28 shrink-0 text-base font-medium text-ink">{enumLabel("stage", s.stage)}</span>
                {/* UAT TOM-ANA-9 binds this bar: it is scaled against the LONGEST wait
                    on screen, not against a target, because no org goal exists for
                    per-stage dwell. One neutral colour down the whole column, so the
                    reader can see where the time concentrates without the page
                    pronouncing a verdict nobody set the benchmark for. */}
                <span className="relative h-px flex-1 self-center bg-stone-200">
                  <span
                    className="absolute inset-y-0 -top-[2px] left-0 h-[5px] rounded-full bg-steel/60"
                    style={{ width: `${Math.max(2, Math.round((s.avgDays / maxDays) * 100))}%` }}
                    aria-hidden
                  />
                </span>
                <span className="w-40 shrink-0 text-right text-base text-steel nums">
                  {t("stageDwellRow", { days: s.avgDays, count: s.count })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {/* The loss BEFORE the funnel's first stage. KO-gate discards never mint an
          entry, so without this line the ad that attracts mostly ineligible
          applicants reads as a healthy low-volume channel. The by-role table shows
          the same loss per role, but only for the roles that survive its volume cap;
          this is the account-wide figure. */}
      {koDeclined > 0 ? (
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-steel">{t("koDeclinedLine", { count: koDeclined })}</p>
      ) : null}

      {/* …and the leg after the last stage. Honesty-gated below the min-offers floor
          by the panel itself, and it is also the only place the brief states the
          acceptance rate its forecast band silently assumes. */}
      <OfferLegPanel offers={offers} boardHref={boardHref} offerStage={offerStage} />
    </section>
  );
}
