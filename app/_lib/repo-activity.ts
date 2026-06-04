// Named, documented repo-activity windows for the GitHub-analysis metrics (idea-889dcaf4).
//
// These two windows back the recruiter-facing "Active" tile and the contribution signals, so
// the definition behind them must be a decided spec, not an accident of two magic numbers. Two
// deliberate choices are pinned here (and unit-tested in repo-activity.test.ts):
//
//  1. Count `pushed_at`, NOT `updated_at`, for code-activity. GitHub bumps `updated_at` on
//     metadata edits (a new star, a description tweak, a topic change); `pushed_at` only moves
//     on real commits. Mixing the two let `recentlyUpdatedRepos` be inflated by non-code
//     activity, so callers pass `pushed_at ?? updated_at` and these windows mean code activity.
//  2. A month is approximated as 30 days, so ACTIVE = 360 days and RECENT = 90 days. This is a
//     coarse activity bucket for a hiring signal, not a calendar computation — the 30-day
//     approximation is intentional and documented rather than silently baked into a one-liner.

export const ACTIVE_WINDOW_MONTHS = 12; // "active": pushed within the last year
export const RECENT_WINDOW_MONTHS = 3; // "recently updated": pushed within the last quarter

const DAYS_PER_MONTH = 30; // deliberate approximation — see the note above
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// True iff `dateText` parses to a real date no older than `months` (× 30 days) before `now`.
// The boundary is inclusive (a date exactly at the threshold counts as within). `now` is
// injectable so the boundary semantics can be pinned deterministically in tests.
export function isWithinMonths(dateText: string | null, months: number, now: number = Date.now()): boolean {
  if (!dateText) return false;
  const date = new Date(dateText).getTime();
  const threshold = now - months * DAYS_PER_MONTH * MS_PER_DAY;
  return Number.isFinite(date) && date >= threshold;
}
