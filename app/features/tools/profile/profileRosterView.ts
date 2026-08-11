// Pure view model for the saved-profile roster: which rows survive the column
// filters, in what order, and which options each filter should offer.
//
// Deliberately free of React and next-intl so the filtering/sorting rules unit-test
// directly (profileRosterView.test.ts) instead of only through a rendered table.
// The component passes in the two things that ARE locale-bound — the collator's
// locale and an `enumLabel` resolver — so sorting and filtering agree with what the
// reader actually sees: a Czech user filtering the Archetype column picks
// "Absolvent", so the row match has to be made on the LABEL, not on the wire id.

import { archetypeDisplayKey } from "@/app/_lib/archetypes";
import type { RosterProfile, StaleMap } from "./ProfileRosterTypes";

/** A profile's one-word standing, and the vocabulary the Status column filters on. */
export type RosterStatus = "current" | "stale" | "retired";

export type RosterFilters = {
  /** Free text over the candidate name. */
  q: string;
  /** Archetype DISPLAY key (see archetypeDisplayKey) — "" means all. */
  archetype: string;
  /** Role-family wire value — "" means all. */
  family: string;
  /** RosterStatus — "" means all. */
  status: string;
};

export type RosterSortCol = "name" | "archetype" | "family" | "completeness";
export type RosterSort = { col: RosterSortCol; dir: "asc" | "desc" };

export type Facet = { value: string; label: string };
export type RosterFacets = { archetypes: Facet[]; families: Facet[]; statuses: Facet[] };

type EnumLabel = (group: string, slug: string | null | undefined) => string;
type StatusLabel = (status: RosterStatus) => string;

/**
 * A profile's standing. Retired outranks stale: a profile routed to an archetype
 * that no longer exists is the more urgent thing to fix, and showing two flags
 * competing in one cell was what made the old card list hard to scan.
 */
export function rosterStatus(
  p: RosterProfile,
  stale: StaleMap,
  archivedSet: ReadonlySet<string>
): RosterStatus {
  if (p.archetype && archivedSet.has(p.archetype)) return "retired";
  if (stale[p.id]) return "stale";
  return "current";
}

/** Options for each column filter — only values actually PRESENT in the roster, so
 *  the menus can never offer a filter that yields zero rows. */
export function rosterFacets(
  profiles: readonly RosterProfile[],
  opts: {
    locale: string;
    enumLabel: EnumLabel;
    stale: StaleMap;
    archivedSet: ReadonlySet<string>;
    statusLabel: StatusLabel;
  }
): RosterFacets {
  const { locale, enumLabel, stale, archivedSet, statusLabel } = opts;
  const collator = new Intl.Collator(locale);
  const byLabel = (a: Facet, b: Facet) => collator.compare(a.label, b.label);

  const archetypes = [...new Set(profiles.map((p) => archetypeDisplayKey(p.archetype)))]
    .map((value) => ({ value, label: enumLabel("archetype", value) }))
    .sort(byLabel);

  const families = [...new Set(profiles.map((p) => p.role_family).filter((f): f is string => Boolean(f)))]
    .map((value) => ({ value, label: enumLabel("family", value) }))
    .sort(byLabel);

  // Status is a closed vocabulary, so it keeps its severity order (worst first)
  // rather than being alphabetized — but still lists only what is present.
  const present = new Set(profiles.map((p) => rosterStatus(p, stale, archivedSet)));
  const statuses = (["retired", "stale", "current"] as const)
    .filter((s) => present.has(s))
    .map((value) => ({ value, label: statusLabel(value) }));

  return { archetypes, families, statuses };
}

/** The rows to render: filtered, then ordered. */
export function rosterRows(
  profiles: readonly RosterProfile[],
  opts: {
    filters: RosterFilters;
    sort: RosterSort;
    stale: StaleMap;
    archivedSet: ReadonlySet<string>;
    locale: string;
    enumLabel: EnumLabel;
  }
): RosterProfile[] {
  const { filters, sort, stale, archivedSet, locale, enumLabel } = opts;
  const needle = filters.q.trim().toLowerCase();
  const collator = new Intl.Collator(locale);

  const kept = profiles.filter((p) => {
    if (needle && !p.label.toLowerCase().includes(needle)) return false;
    if (filters.archetype && archetypeDisplayKey(p.archetype) !== filters.archetype) return false;
    if (filters.family && p.role_family !== filters.family) return false;
    if (filters.status && rosterStatus(p, stale, archivedSet) !== filters.status) return false;
    return true;
  });

  const dir = sort.dir === "asc" ? 1 : -1;
  const compare = (a: RosterProfile, b: RosterProfile): number => {
    switch (sort.col) {
      case "completeness":
        // Nulls sort as -1, i.e. always at the "least complete" end — an unknown
        // completeness is not a 0% one, but it is the row that needs attention.
        return (a.completeness ?? -1) - (b.completeness ?? -1);
      case "archetype":
        return collator.compare(
          enumLabel("archetype", archetypeDisplayKey(a.archetype)),
          enumLabel("archetype", archetypeDisplayKey(b.archetype))
        );
      case "family":
        return collator.compare(enumLabel("family", a.role_family), enumLabel("family", b.role_family));
      case "name":
      default:
        return collator.compare(a.label, b.label);
    }
  };

  // Name is the stable tie-breaker on every other column, so re-sorting by a coarse
  // column (archetype, status) doesn't shuffle rows that compare equal.
  return [...kept].sort((a, b) => {
    const primary = compare(a, b) * dir;
    return primary !== 0 ? primary : collator.compare(a.label, b.label);
  });
}
