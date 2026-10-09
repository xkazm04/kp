// The Salary page's rulers (WP4). One ruler per currency/pay-basis partition; the partition the
// engine RATED is the comparable one, every other partition is its own ruler headed "not
// comparable" and is never converted. Rows are ordered by the figure (low to high), which is an
// order of cost, never of merit: salary names no leader, ever.
//
// What the ruler can shade is what the view carries. When the cohort was rated against its own
// median (cells.salaryCohort) the +/-COHORT_MEDIAN_TOLERANCE window around that median is the
// band and is drawn. When it was rated against the ROLE's band (cells.salaryBand) the view does
// not carry the band's edges (CohortView has no roleBand), so nothing is shaded and each row says
// only what its rating proves: inside the band (rating 100, by rateAgainstRange) or outside it.
import type { CohortMember, CohortView } from "../cohortTypes.ts";
import { COHORT_MEDIAN_TOLERANCE, salaryKey } from "../cohortProject.ts";
import { absentGroups, byNeutral, pendingOn, type AbsentGroup } from "./dimensionModel.ts";

export type BandBasis = "role" | "cohort" | "none";

export interface SalaryRow {
  member: CohortMember;
  min: number;
  max: number;
  mid: number;
  confidence: string | null;
  rating: number | null;
  /** Rated against the role band: inside it (true) or outside (false); else null. */
  inBand: boolean | null;
}

export interface SalaryRuler {
  key: string;
  currency: string;
  period: string;
  comparable: boolean;
  basis: BandBasis;
  rows: SalaryRow[];
  scale: { min: number; max: number; ticks: number[] };
  /** The shaded window (cohort basis only). */
  window: { lo: number; hi: number; median: number } | null;
}

export interface SalaryModel {
  rulers: SalaryRuler[];
  pending: CohortMember[];
  /** Absent for a reason other than another currency (those stand on their own ruler). */
  absent: AbsentGroup[];
}

/** A 1/2/5 x 10^k step that cuts [lo, hi] into about `count` parts. */
export function niceStep(span: number, count = 5): number {
  if (!(span > 0)) return 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / pow;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * pow;
}

export function niceScale(lo: number, hi: number): SalaryRuler["scale"] {
  if (!(hi > lo)) {
    const pad = Math.max(1, Math.abs(lo) * 0.1);
    return niceScale(lo - pad, hi + pad);
  }
  const step = niceStep(hi - lo);
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { min, max, ticks };
}

export function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length / 2;
  return s.length % 2 ? s[Math.floor(mid)] : (s[mid - 1] + s[mid]) / 2;
}

function rowOf(m: CohortMember): SalaryRow | null {
  const d = m.detail.salary;
  if (!d || d.midpoint == null || !d.currency || !d.period) return null;
  const mid = d.midpoint;
  const min = d.minimum ?? mid;
  const max = d.maximum ?? mid;
  const basis = m.cells.salary.label.key;
  const rating = m.cells.salary.rating;
  return { member: m, min: Math.min(min, mid), max: Math.max(max, mid), mid, confidence: d.confidence, rating, inBand: basis === "cells.salaryBand" && rating != null ? rating === 100 : null };
}

/** Partition every member with a readable figure; the rated partition first, then by size. */
export function salaryRulers(view: CohortView): SalaryRuler[] {
  const parts = new Map<string, SalaryRow[]>();
  for (const m of view.members) {
    const row = rowOf(m);
    if (!row) continue;
    const key = salaryKey(m.detail.salary!.currency!, m.detail.salary!.period!);
    parts.set(key, [...(parts.get(key) ?? []), row]);
  }
  const rulers = [...parts.entries()].map(([key, rows]): SalaryRuler => {
    const [currency, period] = key.split("/");
    const comparable = rows.some((r) => r.rating != null);
    const labelKey = rows.find((r) => r.rating != null)?.member.cells.salary.label.key;
    const basis: BandBasis = !comparable ? "none" : labelKey === "cells.salaryCohort" ? "cohort" : "role";
    rows.sort((a, b) => a.mid - b.mid || byNeutral(a.member, b.member));
    let window: SalaryRuler["window"] = null;
    if (basis === "cohort") {
      const med = median(rows.filter((r) => r.rating != null).map((r) => r.mid));
      window = { lo: med * (1 - COHORT_MEDIAN_TOLERANCE), hi: med * (1 + COHORT_MEDIAN_TOLERANCE), median: med };
    }
    const lo = Math.min(...rows.map((r) => r.min), window?.lo ?? Infinity);
    const hi = Math.max(...rows.map((r) => r.max), window?.hi ?? -Infinity);
    return { key, currency, period, comparable, basis, rows, scale: niceScale(lo, hi), window };
  });
  return rulers.sort((a, b) => Number(b.comparable) - Number(a.comparable) || b.rows.length - a.rows.length || (a.key < b.key ? -1 : 1));
}

export function salaryModel(view: CohortView): SalaryModel {
  return {
    rulers: salaryRulers(view),
    pending: pendingOn(view, "salary").filter((m) => !m.detail.salary),
    absent: absentGroups(view, "salary").filter((g) => g.reason !== "currencyMismatch"),
  };
}
