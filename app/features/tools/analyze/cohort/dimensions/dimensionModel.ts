// The dimension pages' shared pure half (spark analyze-v2-cohort, WP4): who is rated, who is
// still landing, who is absent and why, how a member is named in a narrow column, and how the
// page's member focus steps. CLIENT-SAFE and pure: every page model builds on these, and every
// rule here is pinned by dimensionModel.test.ts.
import { ABSENT_REASONS } from "../cohortTypes.ts";
import type { AbsentReason, CohortDimension, CohortMember, CohortView } from "../cohortTypes.ts";

/** One absent reason and the members it holds, in the contract's reason order. */
export interface AbsentGroup {
  reason: AbsentReason;
  members: CohortMember[];
  /** A finer reason a page knows (public work: the GitHub read failed, not the analysis). */
  note?: "readFailed";
}

/** The neutral tie-break: the recorded presentation order, never the verdict. */
export const byNeutral = (a: CohortMember, b: CohortMember): number => a.neutralIndex - b.neutralIndex;

export const ratingOf = (m: CohortMember, d: CohortDimension): number | null => m.cells[d].rating;

/** Rated members on a dimension, best first; ties keep the neutral order (an order, never a lead). */
export function ratedOn(view: CohortView, d: CohortDimension): CohortMember[] {
  return view.members
    .filter((m) => ratingOf(m, d) != null)
    .sort((a, b) => (ratingOf(b, d) as number) - (ratingOf(a, d) as number) || byNeutral(a, b));
}

/** Members whose analysis has not landed yet: drawn as the thing itself, unfilled. */
export function pendingOn(view: CohortView, d: CohortDimension): CohortMember[] {
  return view.members.filter((m) => m.cells[d].absentReason === "pending").sort(byNeutral);
}

/**
 * The honest remainder of a dimension: every absent member that is not pending, grouped by
 * reason in `order` (default: the contract's order). A reason with no member is omitted.
 */
export function absentGroups(view: CohortView, d: CohortDimension, order: readonly AbsentReason[] = ABSENT_REASONS): AbsentGroup[] {
  const groups: AbsentGroup[] = [];
  for (const reason of order) {
    if (reason === "pending") continue;
    const members = view.members.filter((m) => m.cells[d].tier === "absent" && m.cells[d].absentReason === reason).sort(byNeutral);
    if (members.length) groups.push({ reason, members });
  }
  return groups;
}

/**
 * A member's name in a narrow column: the letter of a blind label ("Candidate C" -> "C"),
 * else the initials of the first and last word ("Klára Blažková" -> "KB"). The full label is
 * always one focus away (the column's accessible name and its tip).
 */
export function shortName(label: string): string {
  const blind = /^Candidate\s+(\S+)$/.exec(label.trim());
  if (blind) return blind[1];
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = [...words[0]][0] ?? "?";
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * The next member stop for j/k (or the arrows): `ids` is the page's stop order, `current` the
 * focused member. No focus yet -> the first (down) or the last (up); the ends hold (no wrap,
 * so a held key does not cycle the reader past where they meant to stop).
 */
export function stepMember(ids: readonly string[], current: string | null, delta: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const at = current == null ? -1 : ids.indexOf(current);
  if (at < 0) return delta > 0 ? ids[0] : ids[ids.length - 1];
  return ids[Math.max(0, Math.min(ids.length - 1, at + delta))];
}

/**
 * One j/k stop per member: the FIRST place a page renders a member carries `data-dim-stop` (a
 * member can appear several times on a ledger page). Each call names its SLOT (a stable key for
 * that place), and the answer for a slot never changes once given, so a child component that
 * renders twice (React's dev double render) still gets the same answer. Create one per page
 * render; call it in render order, which is document order.
 */
export function makeStops(): (memberId: string, slot: string) => boolean {
  const first = new Map<string, string>();
  return (id, slot) => {
    const at = first.get(id);
    if (at === undefined) {
      first.set(id, slot);
      return true;
    }
    return at === slot;
  };
}

/** Map a value on [min, max] to a CSS percentage, clamped; a flat scale centres the value. */
export function pctOn(value: number, min: number, max: number): number {
  if (!(max > min)) return 50;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}
