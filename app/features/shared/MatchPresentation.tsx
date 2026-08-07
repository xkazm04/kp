"use client";

import { SearchX } from "lucide-react";
import { useTranslations } from "next-intl";
import { Meter } from "@/app/_components/Meter";
import { scoreTone, scoreToneColor } from "@/app/_lib/format";
import type { KoReason, MatchResponse, ScoreDimension } from "@/app/features/shared/matchTypes";
import { isEarlyCareer } from "@/app/features/shared/matchTypes";

// Presentational match primitives shared across features: score bars, the score
// breakdown, the no-matches explainer and the KO notes. The i18n resolvers now
// live in ./matchLabels and the reasoning panel in ./MatchReasoningPanel; both are
// re-exported here so the existing `shared/MatchPresentation` import path (8 call
// sites across hiring, library and tools) keeps working unchanged.
import { useMatchLabels } from "./matchLabels";
export { useConfidenceBandCopy, useFitTierLabels, useMatchLabels } from "./matchLabels";
export { ReasoningPanel } from "./MatchReasoningPanel";

export function Bar({ label, value }: { label: string; value: number }) {
  const t = useTranslations("match.shared");
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  // Fill color tracks the score (weak -> mid -> strong), not just bar length,
  // and shares the app-wide 75/50 cutoffs via scoreTone so a bar never disagrees
  // with the badge/dial for the same number.
  const tone = scoreTone(pct);
  return (
    <div>
      <div className="flex justify-between text-sm text-steel">
        <span className="uppercase">{label}</span>
        <span className="tabular-nums tracking-tight">{pct}</span>
      </div>
      <Meter value={pct} tone={tone} className="mt-0.5" aria-label={t("barAria", { label, score: pct })} />
    </div>
  );
}

// Weight-aware "where the score comes from" bar. Each dimension's SEGMENT WIDTH is
// its contribution (the points it adds to the total), so the highest-weighted,
// best-scoring dimension reads as visually dominant and the filled width equals the
// headline total — the trailing track is the unearned remainder (100 - total). The
// segment + legend-dot hue reuse the app-wide score scale (scoreTone) so a strong
// dimension is green here exactly as on the badge/dial. Every number is
// server-supplied (matching.build_score_breakdown): the bar carries `contribution`,
// the legend carries `percent` + `weight`, so it renders with zero client-side math
// and no 0-1 vs 0-100 scale guessing — the bug this replaces.
export function ScoreBreakdown({ dims, total }: { dims: ScoreDimension[]; total: number }) {
  const t = useTranslations("match.shared");
  const { dimLabel } = useMatchLabels();
  const remainder = Math.max(0, 100 - total);
  const detail = dims
    .map((d) => t("dimContribution", { label: dimLabel(d), contribution: Math.round(d.contribution), weight: d.weight }))
    .join(", ");
  return (
    <div className="mt-2 max-w-md">
      <div
        className="flex h-2 gap-px overflow-hidden rounded-full bg-stone-100"
        role="img"
        aria-label={t("scoreBreakdownAria", { total, detail })}
      >
        {dims.map((d) => (
          <div
            key={d.key}
            style={{ flexGrow: d.contribution, backgroundColor: scoreToneColor(scoreTone(d.percent)) }}
            className="h-full"
          />
        ))}
        <div style={{ flexGrow: remainder }} className="h-full" aria-hidden />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {dims.map((d) => (
          <div key={d.key} className="flex items-center gap-1.5 text-sm text-steel">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: scoreToneColor(scoreTone(d.percent)) }}
              aria-hidden
            />
            <span className="uppercase">{dimLabel(d)}</span>
            <span className="tabular-nums tracking-tight text-ink">{d.percent}</span>
            <span className="tabular-nums tracking-tight">{t("weightPercent", { weight: d.weight })}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// The KO reasons match() now rolls into meta.koReasons (matching.aggregate_ko_reasons):
// one "{n} roles {clause}" line per blocker, counts first so the worst gate reads first.
function KoReasonList({ reasons }: { reasons: KoReason[] }) {
  const t = useTranslations("match.shared");
  const { koLabel } = useMatchLabels();
  return (
    <ul className="mt-2 space-y-1 text-left">
      {reasons.map((r) => (
        <li key={r.key} className="flex gap-2 text-sm text-steel">
          <span className="shrink-0 font-semibold tabular-nums text-ink">{t("roleCount", { count: r.count })}</span>
          <span>{koLabel(r)}</span>
        </li>
      ))}
    </ul>
  );
}

// Empty state for a 0-match run. Everything filtered means survivors === 0, so the
// aggregated blockers ARE the explanation — surface them plus a keyed next action
// instead of a blank list. (An empty corpus is a distinct, simpler story.)
export function NoMatchesExplainer({ meta, archetype }: { meta: MatchResponse["meta"]; archetype: string }) {
  const t = useTranslations("match.shared");
  const evaluated = meta.evaluated ?? 0;
  const reasons = meta.koReasons ?? [];
  const early = isEarlyCareer(archetype);

  if (evaluated === 0) {
    return (
      <Card>
        <p className="text-base font-semibold text-ink">{t("noJobsTitle")}</p>
        <p className="mt-1 text-base text-steel">{t("noJobsBody")}</p>
      </Card>
    );
  }

  // Next-action hint keyed off the dominant KO category (catalog: match.shared.koHint.*).
  const hintKey = reasons.length ? reasons[0].key : "other";
  const hintPath = `koHint.${hintKey}` as Parameters<typeof t>[0];
  const hint = t.has(hintPath) ? t(hintPath) : t("koHint.other");
  return (
    <Card>
      <p className="text-base font-semibold text-ink">
        {early ? t("noEntryRoles") : t("noRoles")}
      </p>
      <p className="mt-1 text-base text-steel">{t("allKnockedOut", { count: evaluated })}</p>
      {reasons.length ? <KoReasonList reasons={reasons} /> : null}
      <p className="mt-3 max-w-sm text-sm text-steel">{hint}</p>
    </Card>
  );
}

// Thin-but-non-empty result: most of the corpus was filtered, so name the dominant
// blocker inline above the (short) list rather than leaving the gap unexplained.
export function KoReasonsNote({ koFiltered, reasons }: { koFiltered: number; reasons: KoReason[] }) {
  const t = useTranslations("match.shared");
  const { koLabel } = useMatchLabels();
  if (!koFiltered || !reasons.length) return null;
  return (
    <p className="mt-2 text-sm text-steel">
      {t.rich("koReasonsNote", {
        count: koFiltered,
        reason: koLabel(reasons[0]),
        b: (chunks) => <span className="font-semibold text-ink">{chunks}</span>,
      })}
    </p>
  );
}

// Shared dashed-card shell mirroring the app-wide EmptyState treatment (icon + copy).
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-stone-300 bg-paper/50 px-6 py-10 text-center">
      <SearchX className="h-8 w-8 text-steel" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function Chip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "green" | "amber";
}) {
  const toneClass =
    tone === "green"
      ? "border-green-200 bg-green-50 text-green-800"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-stone-200 bg-paper text-ink";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm ${toneClass}`}>
      <span className="uppercase tracking-wide text-steel">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}
