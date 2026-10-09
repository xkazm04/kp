// The Public work page (WP4): evidence cards for the members whose GitHub was READ, then the
// honest remainder grouped by WHY there is no card, in the order a reader asks it: the role is
// not technical, the CV names no GitHub, it was not read, the read failed, a blind cohort hides it.
import type { AbsentReason, CohortMember, CohortView, PublicWorkDetail } from "../cohortTypes.ts";
import { absentGroups, byNeutral, pendingOn, type AbsentGroup } from "./dimensionModel.ts";

export const PUBLIC_WORK_REASONS = ["notTechnical", "noLink", "notRead", "failed", "blind", "noJdFit", "currencyMismatch"] as const satisfies readonly AbsentReason[];

export interface EvidenceCard {
  member: CohortMember;
  rating: number;
  detail: PublicWorkDetail;
  /** Languages that fill the bar (percent > 0), largest first, the rest summed as `other`. */
  languages: Array<{ name: string; percent: number }>;
  other: number;
}

export interface PublicWorkModel {
  cards: EvidenceCard[];
  pending: CohortMember[];
  remainder: AbsentGroup[];
}

/** The bar shows the top `keep` languages and folds the tail into one "other" share. */
export function languageBar(langs: PublicWorkDetail["languages"], keep = 4): { languages: EvidenceCard["languages"]; other: number } {
  const sorted = langs.filter((l) => l.percent > 0).sort((a, b) => b.percent - a.percent);
  const head = sorted.slice(0, keep);
  const other = Math.max(0, Math.round(sorted.slice(keep).reduce((acc, l) => acc + l.percent, 0)));
  return { languages: head, other };
}

/**
 * `failed` on this dimension means two different things: the member's whole analysis failed, or
 * the analysis landed and only its GitHub read failed. They are told apart (the second becomes a
 * group of its own, noted `readFailed`), so "Analysis failed" is never said of a landed analysis.
 */
export function splitReadFailed(groups: AbsentGroup[]): AbsentGroup[] {
  return groups.flatMap((g) => {
    if (g.reason !== "failed") return [g];
    const read = g.members.filter((m) => m.runState !== "failed");
    const whole = g.members.filter((m) => m.runState === "failed");
    return [...(read.length ? [{ reason: g.reason, members: read, note: "readFailed" as const }] : []), ...(whole.length ? [{ reason: g.reason, members: whole }] : [])];
  });
}

export function publicWorkModel(view: CohortView): PublicWorkModel {
  const cards = view.members
    .filter((m) => m.cells.publicWork.rating != null && m.detail.publicWork)
    .sort((a, b) => (b.cells.publicWork.rating as number) - (a.cells.publicWork.rating as number) || byNeutral(a, b))
    .map((m): EvidenceCard => ({ member: m, rating: m.cells.publicWork.rating as number, detail: m.detail.publicWork!, ...languageBar(m.detail.publicWork!.languages) }));
  return { cards, pending: pendingOn(view, "publicWork"), remainder: splitReadFailed(absentGroups(view, "publicWork", PUBLIC_WORK_REASONS)) };
}
