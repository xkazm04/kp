import type { AppMasterSpec } from "../schemas.generated";

// The MANDATE, as the card has to show it.
//
// An App master is dispatched under a contract: approval gates Personas will
// actually execute, per-objective targets with a unit, a direction and a
// measurement window, a review cadence, retire criteria, and how the budget is
// reserved. The card used to render one number from all of that — the objective
// COUNT — so the requestor pressed a control that hires an accountable owner
// while seeing none of what that owner is bound by.
//
// This module is the PURE half: spec in, a section model out, no React and no
// next-intl. That split is deliberate — the field mapping is the part worth
// pinning in a node:test (an objective's `target` silently rendered as its
// `baseline` is invisible in JSX review), and it keeps the card thin enough to
// read.
//
// THE ONE RULE HERE: an absent value produces NOTHING. Never a zero, never a
// dash, never "not set". A hole in a mandate is information — "nobody decided
// this yet" — and a fabricated default is how a requestor comes to believe a
// bound they were never shown.

export type MandateObjectiveRow = {
  kpiKey: string;
  label: string;
  /** null when the composer had no target to record — the row still renders, so
   *  an objective with no bar is VISIBLE as an objective with no bar. */
  target: number | null;
  /** "" when absent; the caller renders nothing rather than a bare number. */
  unit: string;
  direction: "gte" | "lte";
  /** null when non-positive: a zero-day window is not a window. */
  windowDays: number | null;
};

export type MandateView = {
  approvalGates: string[];
  objectives: MandateObjectiveRow[];
  reviewCadenceDays: number | null;
  retireCriteria: string[];
  reservationPolicy: "estimate" | "fixed" | null;
  /** True when there is nothing at all to show — the card renders no section,
   *  rather than an empty heading implying the mandate is blank. */
  isEmpty: boolean;
};

const EMPTY: MandateView = {
  approvalGates: [],
  objectives: [],
  reviewCadenceDays: null,
  retireCriteria: [],
  reservationPolicy: null,
  isEmpty: true,
};

/** Non-blank, trimmed entries only. A gate that is whitespace is not a gate. */
function textList(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((v) => (typeof v === "string" ? v.trim() : "")).filter((v) => v.length > 0);
}

/** A positive, finite day count, or null. Guards both the "0 means unset" case
 *  and a NaN arriving from a hand-edited row. */
function days(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function mandateSections(spec: AppMasterSpec | null | undefined): MandateView {
  if (!spec) return EMPTY;

  const approvalGates = textList(spec.mandate?.approvalGates);
  const objectives: MandateObjectiveRow[] = (spec.objectives ?? []).map((o) => ({
    kpiKey: String(o.kpiKey ?? ""),
    // The label is what a human reads; falling back to the machine key beats
    // rendering an unlabelled row, and the key is real (never invented).
    label: typeof o.label === "string" && o.label.trim() ? o.label.trim() : String(o.kpiKey ?? ""),
    target: typeof o.target === "number" && Number.isFinite(o.target) ? o.target : null,
    unit: typeof o.unit === "string" ? o.unit.trim() : "",
    direction: o.direction === "lte" ? "lte" : "gte",
    windowDays: days(o.windowDays),
  }));
  const reviewCadenceDays = days(spec.tenure?.reviewCadenceDays);
  const retireCriteria = textList(spec.tenure?.retireCriteria);
  const reservationPolicy =
    spec.budget?.reservationPolicy === "fixed" || spec.budget?.reservationPolicy === "estimate"
      ? spec.budget.reservationPolicy
      : null;

  return {
    approvalGates,
    objectives,
    reviewCadenceDays,
    retireCriteria,
    reservationPolicy,
    isEmpty:
      approvalGates.length === 0 &&
      objectives.length === 0 &&
      reviewCadenceDays === null &&
      retireCriteria.length === 0 &&
      reservationPolicy === null,
  };
}
