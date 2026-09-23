"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { OfferConversion } from "@/app/_lib/analytics-offer";
import { SectionTitle } from "@/app/_components/ui/SectionTitle";
import { EYEBROW } from "@/app/_components/ui/recipes";
import { OfferLegPanel } from "./AnalyticsOfferLegPanel";
import { dwellBandHasContent, dwellBarDays, dwellBarPct, dwellMaxDays, dwellRowModel, dwellWaiting, type DwellTone } from "./stageDwellGate";
import { StageCadenceInput } from "./AnalyticsStageCadenceInput";
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
/** The bar's colour per row tone. Neutral unless the team set this column's cadence. */
const DWELL_BAR_TONE: Record<DwellTone, string> = {
  neutral: "bg-steel/60",
  over: "bg-coral",
  within: "bg-moss/70",
};

export function StageDwellPanel({
  stageDwell,
  koDeclined,
  offers,
  offerStage,
  enumLabel,
  boardHref,
  onCadenceSaved,
}: {
  stageDwell: Analytics["stageDwell"];
  /** Applicants the eligibility gate turned away BEFORE the funnel's first stage. */
  koDeclined: number;
  offers: OfferConversion;
  /** The workspace’s own offer column, forwarded to the offer panel’s board link. */
  offerStage: string | null;
  enumLabel: (kind: string, value: string) => string;
  boardHref: (filter: { q?: string; stage?: string; quick?: string }) => string;
  /** Re-fetch the payload after a cadence save, so the row re-judges on the new value. */
  onCadenceSaved: () => void;
}) {
  const t = useTranslations("analytics");

  // Nothing measured anywhere: the funnel band above already carries the brief's one
  // „not yet" (briefNoDataClaim / the zero-transition guide), and a second refusal in
  // the same voice two inches below it is just louder, not more honest. Below at least
  // one of the three edges has something to report, so the band earns its rule.
  // The gate, the headline count and the bar scale are pure (stageDwellGate.ts) so
  // `npm run test:unit` can execute them: the rule that decides whether a whole band
  // of the briefing appears was an inline && chain inside JSX, which no test can reach.
  if (!dwellBandHasContent(stageDwell, koDeclined, offers.extended)) return null;

  const waiting = dwellWaiting(stageDwell);
  const maxDays = dwellMaxDays(stageDwell);

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
        <ul className="mt-5 max-w-4xl space-y-2">
          {stageDwell.map((s) => {
            // What the row may claim is pure (stageDwellGate.ts dwellRowModel): no
            // median below the sample floor, a verdict colour only against a cadence
            // the TEAM set, and a board link only when someone is past it.
            const m = dwellRowModel(s);
            const figures =
              m.medianDays != null && m.oldestDays != null
                ? t("stageDwellPair", { median: m.medianDays, oldest: m.oldestDays, count: m.count })
                : m.oldestDays != null
                  ? t("stageDwellThin", { oldest: m.oldestDays, count: m.count })
                  : t("stageDwellRow", { days: s.avgDays, count: s.count });
            const pastLabel =
              m.cadenceDays == null
                ? null
                : m.pastCadence > 0
                  ? t(m.cadenceSource === "team" ? "stageDwellPastTeam" : "stageDwellPastDefault", { count: m.pastCadence, days: m.cadenceDays })
                  : m.cadenceSource === "team"
                    ? t("stageDwellWithinTeam", { days: m.cadenceDays })
                    : null;
            return (
              <li key={s.stage} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <Link
                  href={boardHref({ stage: s.stage })}
                  title={t("viewInBoard")}
                  className="focus-ring -mx-1.5 flex min-w-0 flex-1 basis-80 items-center gap-4 rounded-md px-1.5 py-1 hover:bg-paper/70"
                >
                  <span className="w-28 shrink-0 text-base font-medium text-ink">{enumLabel("stage", s.stage)}</span>
                  {/* UAT TOM-ANA-9 still binds the SCALE: bars are relative to the
                      oldest wait on screen, not to a target. The COLOUR is a verdict
                      only where a goal exists that someone set — the team's cadence
                      for this column (coral: someone is past it; moss: nobody is).
                      Against the shipped role default the bar stays neutral. */}
                  <span className="relative h-px flex-1 self-center bg-stone-200">
                    <span
                      className={`absolute inset-y-0 -top-[2px] left-0 h-[5px] rounded-full ${DWELL_BAR_TONE[m.tone]}`}
                      style={{ width: `${dwellBarPct(dwellBarDays(s), maxDays)}%` }}
                      aria-hidden
                    />
                  </span>
                  <span className="shrink-0 text-right text-base text-steel nums">{figures}</span>
                </Link>
                {pastLabel || (s.cadenceEditable && m.cadenceDays != null) ? (
                  <span className="flex flex-wrap items-center gap-3">
                    {pastLabel && m.link ? (
                      <Link
                        href={boardHref(m.link)}
                        title={t("viewInBoard")}
                        className={`focus-ring rounded-md text-sm font-medium underline-offset-2 hover:underline nums ${m.tone === "over" ? "text-coral" : "text-ink"}`}
                      >
                        {pastLabel}
                      </Link>
                    ) : pastLabel ? (
                      <span className="text-sm text-steel nums">{pastLabel}</span>
                    ) : null}
                    {s.cadenceEditable && m.cadenceDays != null ? (
                      <StageCadenceInput
                        stage={s.stage}
                        stageLabel={enumLabel("stage", s.stage)}
                        teamDays={m.cadenceSource === "team" ? m.cadenceDays : null}
                        defaultDays={m.cadenceDays}
                        onSaved={onCadenceSaved}
                      />
                    ) : null}
                  </span>
                ) : null}
              </li>
            );
          })}
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
