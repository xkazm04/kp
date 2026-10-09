// The Signals page's shared ledger (WP4): every soft signal the analyses read, grouped by what it
// says (case-insensitive label) across members, strengths facing antipatterns. A carrier's
// confidence is its WEIGHT on the row (an unstated confidence weighs 0.5, the engine's own
// default, and is marked as unstated); the row's weight is the sum. Each carrier keeps its
// suggested probe, so the focused member's probes are ready to copy into an interview plan.
import type { CohortMember, CohortView } from "../cohortTypes.ts";
import { absentGroups, byNeutral, pendingOn, type AbsentGroup } from "./dimensionModel.ts";

export type SignalKind = "strength" | "antipattern";

/** cohortProject.confidenceOf: the weight of a confidence the analysis did not state. */
export const UNSTATED_CONFIDENCE = 0.5;

export interface SignalCarrier {
  member: CohortMember;
  confidence: number | null;
  detail: string;
  probe: string | null;
}

export interface SignalRow {
  key: string;
  label: string;
  kind: SignalKind;
  carriers: SignalCarrier[];
  weight: number;
}

export interface SignalsModel {
  strengths: SignalRow[];
  antipatterns: SignalRow[];
  /** Members whose signals were read and named nothing either way. */
  quiet: CohortMember[];
  pending: CohortMember[];
  absent: AbsentGroup[];
}

export const weightOf = (c: number | null): number => (typeof c === "number" && Number.isFinite(c) ? c : UNSTATED_CONFIDENCE);

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Group one kind across members: most carriers first, then the heaviest, then by label. */
export function groupSignals(members: readonly CohortMember[], kind: SignalKind): SignalRow[] {
  const rows = new Map<string, SignalRow>();
  for (const m of [...members].sort(byNeutral)) {
    const d = m.detail.signals;
    if (!d) continue;
    for (const s of kind === "strength" ? d.strengths : d.antipatterns) {
      const key = norm(s.label);
      if (!key) continue;
      const row = rows.get(key) ?? { key, label: s.label.trim(), kind, carriers: [], weight: 0 };
      // One member carrying the same signal twice counts once, at its stronger reading.
      const prior = row.carriers.find((c) => c.member.memberId === m.memberId);
      if (prior) {
        if (weightOf(s.confidence) > weightOf(prior.confidence)) Object.assign(prior, { confidence: s.confidence, detail: s.detail, probe: s.probe });
      } else row.carriers.push({ member: m, confidence: s.confidence, detail: s.detail, probe: s.probe });
      rows.set(key, row);
    }
  }
  for (const row of rows.values()) {
    row.carriers.sort((a, b) => weightOf(b.confidence) - weightOf(a.confidence) || byNeutral(a.member, b.member));
    row.weight = Math.round(row.carriers.reduce((acc, c) => acc + weightOf(c.confidence), 0) * 100) / 100;
  }
  return [...rows.values()].sort(
    (a, b) => b.carriers.length - a.carriers.length || b.weight - a.weight || a.label.localeCompare(b.label, "en", { sensitivity: "base" })
  );
}

/** The focused member's signals with a probe, strengths first, in ledger order. */
export function probesFor(model: SignalsModel, memberId: string): Array<{ label: string; kind: SignalKind; probe: string }> {
  const out: Array<{ label: string; kind: SignalKind; probe: string }> = [];
  for (const row of [...model.strengths, ...model.antipatterns]) {
    const c = row.carriers.find((x) => x.member.memberId === memberId);
    if (c?.probe) out.push({ label: row.label, kind: row.kind, probe: c.probe });
  }
  return out;
}

export function signalsModel(view: CohortView): SignalsModel {
  const read = view.members.filter((m) => m.detail.signals);
  return {
    strengths: groupSignals(read, "strength"),
    antipatterns: groupSignals(read, "antipattern"),
    quiet: read.filter((m) => !m.detail.signals!.strengths.length && !m.detail.signals!.antipatterns.length).sort(byNeutral),
    pending: pendingOn(view, "signals"),
    absent: absentGroups(view, "signals"),
  };
}
