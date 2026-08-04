import { useTranslations } from "next-intl";
import { useNumberFormat } from "@/app/_lib/use-number-format";
import { isSameCurrency, normalizeCurrency, salaryBandPosition } from "@/app/_lib/salary-band";
import { Pill, PILL_TONE } from "./GroupEvalPrimitives";
import type { EvalCandidate } from "@/app/features/shared/groupEvalTypes";

// The comparison table's Salary cell + its shared scale type. Split out of
// GroupEvalComparisonCells.tsx to keep that file under the 200-line cap.

// Presentation of the over/under-band verdict: the pure math + the currency-safety
// contract live in salary-band.ts; this only maps the position to a label + tone.
// Callers MUST gate on isSameCurrency first (see SalaryCell) so this never prints a
// confident "% over" for an expectation in a different currency than the band.
function salaryVerdict(mid: number, lo: number, hi: number): { position: "over" | "under" | "within"; pct: number; tone: keyof typeof PILL_TONE } {
  const { position, pct } = salaryBandPosition(mid, lo, hi);
  if (position === "over") return { position: "over", pct, tone: "coral" };
  if (position === "under") return { position: "under", pct, tone: "info" };
  return { position: "within", pct: 0, tone: "moss" };
}

// The shared salary scale (built once in ComparisonTable, consumed per cell) so
// the bars are comparable column-to-column.
export type SalaryScale = { lo: number; hi: number; pct: (v: number) => number };

export function SalaryCell({ c, sal, bandCurrency }: { c: EvalCandidate; sal: SalaryScale; bandCurrency: string }) {
  const t = useTranslations("decisions.groupEval");
  // Reader-locale digit grouping (format.ts number-locale contract).
  const n = useNumberFormat();
  const s = c.salaryExpectation;
  // The over/under-band verdict AND the band-relative bar position are only
  // meaningful when the expectation shares the band's currency — the app does no
  // FX, so a EUR expectation against a CZK band would otherwise print a confident
  // but meaningless "% over" and plot at a bogus spot. On a mismatch we drop the
  // bar/verdict and surface the currencies explicitly instead.
  const comparable = Boolean(s) && isSameCurrency(s!.currency, bandCurrency);
  const verdict = s && comparable && sal.hi > 0 ? salaryVerdict(s.midpoint, sal.lo, sal.hi) : null;
  return (
    <div className="space-y-1">
      <div className="relative h-5 overflow-hidden rounded-md bg-stone-100">
        {sal.hi > 0 ? (
          <span
            className="absolute inset-y-0 bg-moss/15 ring-1 ring-inset ring-moss/30"
            style={{ left: `${sal.pct(sal.lo)}%`, width: `${Math.max(1, sal.pct(sal.hi) - sal.pct(sal.lo))}%` }}
            aria-hidden
          />
        ) : null}
        {s && comparable ? (
          <>
            <span
              className="absolute inset-y-1 rounded-full bg-ink/70"
              style={{ left: `${sal.pct(s.minimum)}%`, width: `${Math.max(1.5, sal.pct(s.maximum) - sal.pct(s.minimum))}%` }}
              aria-hidden
            />
            <span
              className="absolute inset-y-0 w-0.5 bg-coral"
              style={{ left: `${sal.pct(s.midpoint)}%` }}
              title={t("midpointTitle", { range: n.salaryRange(s.midpoint, s.midpoint, { currency: s.currency }) })}
              aria-hidden
            />
          </>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-1">
        <span className="text-sm text-steel">
          {s ? n.salaryRange(s.minimum, s.maximum, { currency: s.currency }) : t("noExpectation")}
        </span>
        {verdict ? (
          <Pill tone={verdict.tone}>
            {t(
              verdict.position === "over" ? "salaryOver" : verdict.position === "under" ? "salaryUnder" : "salaryWithin",
              { pct: verdict.pct }
            )}
          </Pill>
        ) : s && !comparable && sal.hi > 0 ? (
          <Pill
            tone="amber"
            className="whitespace-nowrap"
            title={t("crossCurrencyTitle", {
              expectation: normalizeCurrency(s.currency),
              band: normalizeCurrency(bandCurrency),
            })}
          >
            {t("crossCurrencyPill", { expectation: normalizeCurrency(s.currency), band: normalizeCurrency(bandCurrency) })}
          </Pill>
        ) : null}
      </div>
    </div>
  );
}
