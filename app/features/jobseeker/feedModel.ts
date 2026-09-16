// Pure decisions the /me/jobs, /me/jobs/[id] and /me/scans surfaces make — no React,
// no fetch, so `node --test` pins them (feedModel.test.ts).
//
// CHAIN-AWARE EMPTY STATES. An empty feed has four different causes and each one has
// a different next step; painting one "No jobs yet" over all of them sends the seeker
// to the wrong page. The chain is profile → enabled source → a scan that ran → rows
// above the minimum fit, and the FIRST missing link is the state the page shows.
//
// SALARY COMPARISON. A posting's pay is compared with the seeker's floor ONLY when
// both carry the same currency (salary-band.ts contract: no FX anywhere); a mismatch
// is rendered as "not comparable (X vs Y)", never as a converted number.

import { isSameCurrency, salaryBandPosition, type SalaryBandPosition } from "@/app/_lib/salary-band";
import { DISMISS_REASONS, type DismissReason, type SalaryFloor, type SalaryPeriod } from "@/app/_lib/jobseeker/types";

export type FeedChainFacts = {
  hasProfile: boolean;
  enabledSources: number;
  /** A scan has completed at least once for this workspace (any outcome). */
  hasScanned: boolean;
  /** Rows the current filter returned. */
  rows: number;
  /** Rows the LIVE feed holds regardless of the min-fit filter (what the filter dropped). */
  liveTotal: number;
};

export const FEED_EMPTY_STATES = ["no_profile", "no_sources", "no_scan", "below_min", "nothing_live", "ok"] as const;
export type FeedEmptyState = (typeof FEED_EMPTY_STATES)[number];

export function resolveFeedEmptyState(f: FeedChainFacts): FeedEmptyState {
  if (f.rows > 0) return "ok";
  if (!f.hasProfile) return "no_profile";
  if (f.enabledSources === 0) return "no_sources";
  if (!f.hasScanned) return "no_scan";
  // Scanned, nothing shown: either the filter dropped everything (say how many), or
  // the live feed is genuinely empty (the scan found nothing, or all was dismissed).
  return f.liveTotal > 0 ? "below_min" : "nothing_live";
}

/** Whether the feed should ask the route for rows at all.
 *
 *  A broken chain is not a failed read: with no profile, or with no enabled source,
 *  the page ALREADY knows what it will show (the chain-aware empty state), and the
 *  list route cannot know why it is empty. Fetching anyway spends a request whose
 *  only possible outcomes are an empty page the reader must not be shown as "empty"
 *  and a failure the reader must not be shown at all. */
export function shouldFetchRows(chain: Pick<FeedChainFacts, "hasProfile" | "enabledSources">): boolean {
  return chain.hasProfile && chain.enabledSources > 0;
}

/** The markets EURES is asked for, from the seeker's preferences.
 *
 *  Empty preferences are not "every country": the EURES search takes location codes
 *  and an empty list is a query for nothing. `cz` is the default this install is for
 *  (the Czech market), stated in the button's own copy so the seeker can see which
 *  country the one-click scan will search and change it on /me. */
export const DEFAULT_EURES_COUNTRY = "cz";

export function euresCountries(countries: readonly string[] | null | undefined): string[] {
  const named = (countries ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean);
  return named.length > 0 ? [...new Set(named)] : [DEFAULT_EURES_COUNTRY];
}

/** The dismiss picker's vocabulary IS the wire vocabulary — one list, re-exported so
 *  the component cannot drift from the route's `isDismissReason`. */
export const DISMISS_PICKER_REASONS: readonly DismissReason[] = DISMISS_REASONS;

export type PostingPay = {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: SalaryPeriod | null;
};

export type SalaryComparison =
  /** The posting states no pay: unknown, never "under". */
  | { kind: "unstated" }
  /** The seeker has no floor: nothing to compare against. */
  | { kind: "no_floor" }
  /** Different currencies (or periods): say so with both codes; never convert. */
  | { kind: "not_comparable"; posting: string; floor: string }
  /** `periodConverted`: the floor was restated month<->year (x12) to the posting's period. */
  | { kind: "compared"; verdict: SalaryVerdict; pct: number; periodConverted?: boolean };

/** From the SEEKER's side: `below_floor` = the posting's whole range is under the floor
 *  (`pct` = how far under its max), `meets_floor` = the range starts at or above the
 *  floor, `spans_floor` = the floor falls inside the stated range. */
export type SalaryVerdict = "below_floor" | "meets_floor" | "spans_floor";

const VERDICT_FOR: Record<SalaryBandPosition, SalaryVerdict> = {
  // salaryBandPosition places the FLOOR against the posting's band: the floor "over"
  // the band's max means the role pays less than the seeker will take.
  over: "below_floor",
  under: "meets_floor",
  within: "spans_floor",
};

export function compareSalary(pay: PostingPay, floor: SalaryFloor | null): SalaryComparison {
  if (!pay.currency || (pay.min === null && pay.max === null)) return { kind: "unstated" };
  if (!floor) return { kind: "no_floor" };
  // Currency is never converted (no FX anywhere). PERIOD is: month <-> year is x12, the
  // one arithmetic the matcher also allows (matching._salary_flag), and it is STATED on the
  // result so the panel can say the floor was restated. Anything else (an hourly rate, an
  // unknown period on either side) stays "not comparable" with both units named.
  const label = (c: string, p: SalaryPeriod | null) => (p ? `${c}/${p}` : c);
  if (!isSameCurrency(pay.currency, floor.currency)) {
    return { kind: "not_comparable", posting: label(pay.currency.toUpperCase(), pay.period), floor: label(floor.currency.toUpperCase(), floor.period) };
  }
  let floorAmount = floor.amount;
  let periodConverted = false;
  if (pay.period !== null && pay.period !== floor.period) {
    const monthly = new Set<SalaryPeriod>(["month", "year"]);
    if (!monthly.has(pay.period) || !monthly.has(floor.period)) {
      return { kind: "not_comparable", posting: label(pay.currency.toUpperCase(), pay.period), floor: label(floor.currency.toUpperCase(), floor.period) };
    }
    floorAmount = pay.period === "year" ? floor.amount * 12 : floor.amount / 12;
    periodConverted = true;
  }
  const lo = pay.min ?? pay.max ?? 0;
  const hi = pay.max ?? pay.min ?? 0;
  const { position, pct } = salaryBandPosition(floorAmount, lo, hi);
  return { kind: "compared", verdict: VERDICT_FOR[position], pct, periodConverted };
}

// ── the last-seen anchor ────────────────────────────────────────────────────────────
//
// "New since your last visit" is one comparison against ONE stored tuple, not a counter:
// the anchor is `(firstSeenAt, id)` — the same ordering pair the feed's keyset cursor
// uses — so the header count and the divider agree about the boundary by construction.
// With NO anchor nothing is new: the first visit is quiet (no badge, no divider), never
// "everything is new".

export type FeedTuple = { at: string; id: string };

export function isNewerThanAnchor(tuple: FeedTuple, anchor: FeedTuple | null): boolean {
  if (!anchor) return false;
  return tuple.at > anchor.at || (tuple.at === anchor.at && tuple.id > anchor.id);
}

/** The anchor a page may advance to: the NEWEST tuple among the rows it actually
 *  rendered. Not `rows[0]` — the feed sorts by fit or by last-seen, so the newest
 *  arrival is not the top row — and never a clock reading: an anchor the reader was not
 *  shown would swallow postings they never saw. `null` for an empty page, which
 *  advances nothing. */
export function renderedAnchor(rows: readonly { firstSeenAt: string; id: string }[]): FeedTuple | null {
  let best: FeedTuple | null = null;
  for (const row of rows) {
    const tuple = { at: row.firstSeenAt, id: row.id };
    if (!best || isNewerThanAnchor(tuple, best)) best = tuple;
  }
  return best;
}

/** The cadence choices the Scans page offers for the clock job, in minutes. */
export const SCAN_INTERVALS = [360, 720, 1440] as const;
export type ScanInterval = (typeof SCAN_INTERVALS)[number];

/** The select must show SOME option: an interval the registry set that is not one of
 *  the three (a hand-edited row) snaps to the nearest offered value for display only. */
export function nearestScanInterval(minutes: number): ScanInterval {
  let best: ScanInterval = SCAN_INTERVALS[0];
  for (const v of SCAN_INTERVALS) if (Math.abs(v - minutes) < Math.abs(best - minutes)) best = v;
  return best;
}
