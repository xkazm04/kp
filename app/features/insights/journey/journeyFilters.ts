// The board's filters, as a pure function over the payload.
//
// Every filter here narrows what is DRAWN; none of them changes what a row says.
// That matters for one of them in particular: "Observed rows only" removes rows
// the ledger cannot vouch for, and a band left empty by it must still say so
// (journeyLayout's `never-recorded` / `allGenerated` states) rather than quietly
// reading as "nothing happened".
//
// Pure and JSX-free so `node --test` can load it.

import type { JourneyBoard, JourneyColumn, RoleCluster } from "@/app/_lib/journey/types";

export type JourneyFilterState = {
  /** Selected role ids. Empty = every role. */
  roles: string[];
  activeOnly: boolean;
  observedOnly: boolean;
  /** Include columns whose `origin` is a test run. Off by default: a /uat L2 run
   *  produces genuine columns against a real database and they must never be
   *  read as live traffic. */
  testRuns: boolean;
  /** Free text over the candidate label. Narrows the board rather than only
   *  jumping to a hit, so a search with no match says so instead of silently
   *  leaving the reader where they were. */
  find: string;
};

export const EMPTY_JOURNEY_FILTERS: JourneyFilterState = {
  roles: [],
  activeOnly: false,
  observedOnly: false,
  testRuns: false,
  find: "",
};

/**
 * Fold case and strip combining marks so "Veselá" is found by typing "vesela".
 * Candidate names in this corpus are Czech more often than not, and a find box
 * that needs the right diacritic is a find box that does not work.
 */
export function foldForSearch(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
}

export function columnMatchesFind(column: Pick<JourneyColumn, "candidateLabel" | "stage">, needle: string): boolean {
  if (needle === "") return true;
  const folded = foldForSearch(needle);
  return (
    foldForSearch(column.candidateLabel).includes(folded) || foldForSearch(column.stage).includes(folded)
  );
}

function keepColumn(column: JourneyColumn, filters: JourneyFilterState): boolean {
  if (filters.activeOnly && !column.active) return false;
  if (!filters.testRuns && column.origin.kind === "test-run") return false;
  if (!columnMatchesFind(column, filters.find)) return false;
  return true;
}

/**
 * Narrow the board. Clusters that lose every column are dropped — an empty role
 * cluster with a shared band and a rail but no columns tells the reader nothing
 * and costs a screenful of vertical travel.
 *
 * `totalColumns` is left as the SERVER reported it: it counts the whole role,
 * including the page the client never received, and overwriting it with a
 * filtered count would turn an honest "45 in this role" into a lie about the
 * cohort the rail's "38 of 45" is measured against.
 */
export function filterBoard(board: JourneyBoard, filters: JourneyFilterState): JourneyBoard {
  const roleSet = new Set(filters.roles);
  const clusters: RoleCluster[] = [];
  for (const cluster of board.clusters) {
    if (roleSet.size > 0 && !roleSet.has(cluster.jobId)) continue;
    const columns = cluster.columns.filter((column) => keepColumn(column, filters));
    if (columns.length === 0) continue;
    clusters.push({ ...cluster, columns });
  }
  return { ...board, clusters };
}

/** Is anything narrowing the board right now? Drives the "no matches" copy. */
export function isFiltering(filters: JourneyFilterState): boolean {
  return (
    filters.roles.length > 0 ||
    filters.activeOnly ||
    filters.observedOnly ||
    filters.testRuns ||
    filters.find.trim() !== ""
  );
}

/** Toggle one role in the selection. */
export function toggleRole(filters: JourneyFilterState, jobId: string): JourneyFilterState {
  const roles = filters.roles.includes(jobId)
    ? filters.roles.filter((id) => id !== jobId)
    : [...filters.roles, jobId];
  return { ...filters, roles };
}

/* ── The role picker ────────────────────────────────────────────────────────
 *
 * A chip per role was fine for the six roles in the demo corpus and unusable at
 * the forty a real company runs: they wrapped over two lines and pushed the
 * board itself off the first screen. The control is a single dropdown now, and
 * the ordering is the whole value of it — the reader is looking for a role they
 * already have a name for, so groups and roles are both sorted by name.
 */

export type RolePickerRole = { jobId: string; title: string; roleArea: string | null };

/** One row of the picker. `group` rows are headings and cannot be chosen — the
 *  repo's `Select` renders them through its `disabled` treatment, which is the
 *  closest a custom listbox comes to `<optgroup>` without a native `<select>`
 *  (whose option popup does not follow `[data-theme]`). */
export type RolePickerOption = { value: string; label: string; disabled?: boolean };

/** The sentinel a heading row carries. A job id is a ULID-ish string and can
 *  never collide with it; `ALL_ROLES_VALUE` is the empty string, which is what
 *  "no role filter" already means in `JourneyFilterState.roles`. */
export const ROLE_GROUP_PREFIX = "group:";
export const ALL_ROLES_VALUE = "";

export type RolePickerLabels = {
  allRoles: string;
  ungrouped: string;
  /** `roleArea` is `jobs.role_family`, a canonical English SLUG. The reader is
   *  shown the localized `enums.family.*` label the rest of the app uses; a slug
   *  outside the taxonomy degrades to the slug itself, never to a raw key path
   *  and never to an invented pretty name (jobsMarkdown.ts's `enumLabel`). */
  areaLabel: (slug: string) => string;
  /** Bound to the ACTIVE locale. A plain `.sort()` compares UTF-16 code units,
   *  so Č/Ř/Š/Ž file after Z and a Czech reader gets no order at all — the
   *  lesson `sortOptionsByLabel` in the analyze history already paid for. */
  collator: Intl.Collator;
};

export function rolePickerOptions(
  roles: readonly RolePickerRole[],
  labels: RolePickerLabels
): RolePickerOption[] {
  const groups = new Map<string, RolePickerRole[]>();
  const ungrouped: RolePickerRole[] = [];
  for (const role of roles) {
    // An EMPTY area is the same fact as a missing one — the record does not say
    // which area this role belongs to — and must land in the same honest bucket
    // rather than in a group whose name is "".
    const area = role.roleArea === null ? "" : role.roleArea.trim();
    if (area === "") {
      ungrouped.push(role);
      continue;
    }
    const bucket = groups.get(area);
    if (bucket) bucket.push(role);
    else groups.set(area, [role]);
  }

  const byTitle = (a: RolePickerRole, b: RolePickerRole) => labels.collator.compare(a.title, b.title);
  const options: RolePickerOption[] = [{ value: ALL_ROLES_VALUE, label: labels.allRoles }];

  // Sorted by what the reader SEES, not by the slug underneath it.
  const areas = [...groups.keys()]
    .map((slug) => ({ slug, label: labels.areaLabel(slug) }))
    .sort((a, b) => labels.collator.compare(a.label, b.label));

  for (const area of areas) {
    options.push({ value: `${ROLE_GROUP_PREFIX}${area.slug}`, label: area.label, disabled: true });
    for (const role of (groups.get(area.slug) ?? []).slice().sort(byTitle)) {
      options.push({ value: role.jobId, label: role.title });
    }
  }

  // Last, and named for what it IS. A role whose area the record does not carry
  // is not "Uncategorised admin" or any other invented bucket; `roleArea: null`
  // is a real state and the picker says so.
  if (ungrouped.length > 0) {
    options.push({ value: `${ROLE_GROUP_PREFIX}`, label: labels.ungrouped, disabled: true });
    for (const role of ungrouped.slice().sort(byTitle)) {
      options.push({ value: role.jobId, label: role.title });
    }
  }

  return options;
}

/** The picker is single-select; the filter state is a list because the board's
 *  own narrowing is set-shaped. One place that translates between them. */
export function selectedRole(filters: JourneyFilterState): string {
  return filters.roles[0] ?? ALL_ROLES_VALUE;
}

export function withSelectedRole(filters: JourneyFilterState, jobId: string): JourneyFilterState {
  return { ...filters, roles: jobId === ALL_ROLES_VALUE ? [] : [jobId] };
}
