// The Trust page's severity ledger (WP4): one row per finding CODE across the cohort, the members
// who carry it, blockers first. A member with no warning and no blocker is stated as CLEAN (never
// omitted), a member whose trust ledger was not read is stated as not read (never clean).
import type { CohortMember, CohortView, TrustDetail } from "../cohortTypes.ts";
import { absentGroups, byNeutral, pendingOn, type AbsentGroup } from "./dimensionModel.ts";

export type Severity = TrustDetail["findings"][number]["severity"];
export const SEVERITY_ORDER: readonly Severity[] = ["blocker", "warn", "ok"];

export interface TrustCarrier {
  member: CohortMember;
  severity: Severity;
  scope: string;
  text: string;
}

export interface TrustRow {
  code: string;
  /** The worst severity any carrier holds the code at. */
  severity: Severity;
  carriers: TrustCarrier[];
}

export interface TrustModel {
  /** blocker and warn rows: what a reader must look at. */
  flagged: TrustRow[];
  /** ok rows: checks that ran and passed (quiet, but shown). */
  passed: TrustRow[];
  clean: CohortMember[];
  pending: CohortMember[];
  /** notRead and every other absent reason, in the contract's order. */
  absent: AbsentGroup[];
}

const rankOf = (s: Severity): number => SEVERITY_ORDER.indexOf(s);

export function trustRows(members: readonly CohortMember[]): TrustRow[] {
  const rows = new Map<string, TrustRow>();
  for (const m of [...members].sort(byNeutral)) {
    for (const f of m.detail.trust?.findings ?? []) {
      const code = f.code.trim() || "unclassified";
      const row = rows.get(code) ?? { code, severity: f.severity, carriers: [] };
      row.carriers.push({ member: m, severity: f.severity, scope: f.scope, text: f.text });
      if (rankOf(f.severity) < rankOf(row.severity)) row.severity = f.severity;
      rows.set(code, row);
    }
  }
  for (const row of rows.values()) row.carriers.sort((a, b) => rankOf(a.severity) - rankOf(b.severity) || byNeutral(a.member, b.member));
  return [...rows.values()].sort((a, b) => rankOf(a.severity) - rankOf(b.severity) || b.carriers.length - a.carriers.length || (a.code < b.code ? -1 : 1));
}

export function isClean(m: CohortMember): boolean {
  const d = m.detail.trust;
  return Boolean(d) && d!.findings.every((f) => f.severity === "ok");
}

export function trustModel(view: CohortView): TrustModel {
  const read = view.members.filter((m) => m.detail.trust);
  const rows = trustRows(read);
  return {
    flagged: rows.filter((r) => r.severity !== "ok"),
    passed: rows.filter((r) => r.severity === "ok"),
    clean: read.filter(isClean).sort(byNeutral),
    pending: pendingOn(view, "trust"),
    absent: absentGroups(view, "trust"),
  };
}

/** A code as words when the catalog has none: "employment_overlap" -> "Employment overlap". */
export function humanCode(code: string): string {
  const words = code.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : code;
}
