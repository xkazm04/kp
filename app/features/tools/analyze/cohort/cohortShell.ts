// The Cohort Studio shell's pure rules (spark analyze-v2-cohort, WP3): which variant and
// which data source the studio shows, when the live view stops polling, and the order the
// narrow card list reads in. React-free, so each rule is pinned by cohortShell.test.ts.
import { isCohortVariant, type CohortMember, type CohortStatus, type CohortVariant } from "./cohortTypes.ts";

/** Where the studio's comparison comes from. `live` = the role-first flow over the real
 *  routes; `done` / `running` = the engine's committed fixtures (a dev aid for judging). */
export const COHORT_FIXTURE_MODES = ["live", "done", "running"] as const;
export type CohortFixtureMode = (typeof COHORT_FIXTURE_MODES)[number];
export const isCohortFixtureMode = (v: unknown): v is CohortFixtureMode =>
  typeof v === "string" && (COHORT_FIXTURE_MODES as readonly string[]).includes(v);

/** The persisted-choice keys (per browser, never read by anyone else). */
export const VARIANT_KEY = "kp-analyze-variant";
export const FIXTURE_KEY = "kp-analyze-cohort-fixture";

/** One-shot inbox parse: a valid value is adopted, anything else (absent, junk) is not. */
export const parseVariantParam = (raw: string | null): CohortVariant | null => (isCohortVariant(raw) ? raw : null);
export const parseFixtureParam = (raw: string | null): CohortFixtureMode | null => (isCohortFixtureMode(raw) ? raw : null);

/** Production shows the baseline only: the prototype round never reaches a real install. */
export function activeVariant(prototypesOn: boolean, chosen: CohortVariant): CohortVariant {
  return prototypesOn ? chosen : "v1";
}
/** Production is always live: the fixtures are a dev aid, never a recruiter's data. */
export function activeFixture(prototypesOn: boolean, chosen: CohortFixtureMode): CohortFixtureMode {
  return prototypesOn ? chosen : "live";
}

/** The live view's poll cadence. */
export const COHORT_POLL_MS = 2500;
/** Consecutive transient read failures the poll absorbs before it stops and says so. */
export const COHORT_POLL_FAILURE_LIMIT = 3;

/**
 * Whether the live view reads again. A cohort still queued or running is read again; a
 * terminal one (done / failed) never is. A missing cohort (404) stops at once; a transient
 * failure retries until COHORT_POLL_FAILURE_LIMIT in a row, then stops (the view offers a
 * manual retry instead of hammering a broken route every 2.5 s).
 */
export function shouldPollCohort(input: { status: CohortStatus | null; notFound: boolean; failures: number }): boolean {
  if (input.notFound) return false;
  if (input.failures >= COHORT_POLL_FAILURE_LIMIT) return false;
  // Nothing landed yet: the first read is still owed.
  if (input.status === null) return true;
  return input.status === "queued" || input.status === "running";
}

/** Below this width the studio shows the card list instead of a world. */
export const COHORT_NARROW_PX = 760;

/**
 * The card list's order: rated members by fit rank, then the unrated (pending, failed, no
 * fit) by their neutral presentation position — never by name, never by arrival.
 */
export function orderCards(members: readonly CohortMember[]): CohortMember[] {
  return [...members].sort((a, b) => {
    if (a.fitRank != null && b.fitRank != null) return a.fitRank - b.fitRank || a.neutralIndex - b.neutralIndex;
    if (a.fitRank != null) return -1;
    if (b.fitRank != null) return 1;
    return a.neutralIndex - b.neutralIndex;
  });
}

/** The three acts of the role-first flow, in order. */
export const STUDIO_ACTS = ["role", "cast", "compare"] as const;
export type StudioAct = (typeof STUDIO_ACTS)[number];

/** Where the live flow stands. `from` keeps the tray a run started from, so "back" finds it. */
export type StudioStep =
  | { act: "role" }
  | { act: "cast"; jdSlug: string; jdTitle: string }
  | { act: "compare"; cohortId: string; from: { jdSlug: string; jdTitle: string } | null };

export const actIndex = (step: StudioStep): number => STUDIO_ACTS.indexOf(step.act);
