// The shared salary scale for the comparison table's Salary section: one scale
// across the role band + every SAME-CURRENCY expectation so the bars are
// comparable column-to-column. Split out of GroupEvalComparisonTable.tsx to
// keep that file under the 200-line cap.
import { APP_CURRENCY } from "@/app/_lib/format";
import { isSameCurrency } from "@/app/_lib/salary-band";
import type { EvalCandidate } from "@/app/features/shared/groupEvalTypes";
import type { SalaryScale } from "./GroupEvalSalaryCell";

export function computeSalaryScale(candidates: EvalCandidate[], roleBand: number[]) {
  // The band is a bare [min, max] denominated in APP_CURRENCY by contract (see
  // format.ts); a cross-currency expectation (EUR vs a CZK band) is excluded
  // from the scale on purpose — mixing it in would distort every bar's position
  // and plot the outlier at a meaningless spot — and its cell shows an explicit
  // "not comparable" note instead (SalaryCell).
  const bandCurrency = APP_CURRENCY;
  const [lo, hi] = roleBand.length >= 2 ? [roleBand[0], roleBand[1]] : [0, 0];
  const withSalary = candidates.filter((c) => c.salaryExpectation);
  const comparableSalary = withSalary.filter((c) => isSameCurrency(c.salaryExpectation!.currency, bandCurrency));
  const showSalary = withSalary.length > 0 || hi > 0;
  const vals = [...(hi > 0 ? [lo, hi] : []), ...comparableSalary.flatMap((c) => [c.salaryExpectation!.minimum, c.salaryExpectation!.maximum])].filter((n) => n > 0);
  const loScale = vals.length ? Math.min(...vals) : 0;
  const hiScale = vals.length ? Math.max(...vals) : 1;
  const span = hiScale - loScale || 1;
  const sal: SalaryScale = { lo, hi, pct: (v) => Math.max(0, Math.min(100, ((v - loScale) / span) * 100)) };
  return { bandCurrency, lo, hi, showSalary, sal };
}
