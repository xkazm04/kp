// ANA2 — weekly momentum buckets for the analytics dashboard. Pure: the DB
// layer queries the relevant pipeline_events rows and delegates the bucketing
// here, so the math is unit-testable without a database.
//
// Series mapping (kept NON-OVERLAPPING so a week's bars never double-count one
// transition):
//   - added:    kinds `added` + `intake_degraded` — every entry creation records
//               exactly one of these (the apply route's extra `applied` event and
//               the seed's `matched` would double-count inflow, so neither is used).
//   - advanced: kinds `advanced` (recruiter) + `auto_advanced` (policy pass)
//               EXCEPT moves to Hired (those are the hires).
//   - rejected: kinds `rejected` (recruiter) + `auto_rejected` (policy pass) —
//               non-overlapping for real now: actOnPipelineEntry writes exactly
//               ONE of them per reject, chosen by the actor opt.
//   - hired:    kind `advanced`/`auto_advanced` with toStage Hired — the one
//               writer of a hire (offer-accept routes through
//               actOnPipelineEntry's accept with actor "system").
//
// Buckets are ROLLING 7-day windows ending at `now` (newest last), not calendar
// weeks: they need no timezone anchor, every bucket is the same width (no
// partial current-week bar reading as a collapse), and "the last 7 days" is the
// question the panel answers. `weekStart` is the bucket's first day as an ISO
// date (UTC) for the axis label.

export const MOMENTUM_WEEKS = 8;

// The kinds the DB query must fetch — exported so the SQL IN-list and this
// module's classification can never drift.
export const MOMENTUM_EVENT_KINDS = ["added", "intake_degraded", "advanced", "auto_advanced", "rejected", "auto_rejected"] as const;

export type MomentumEvent = { kind: string; toStage: string | null; createdAt: string };
export type MomentumWeek = { weekStart: string; added: number; advanced: number; rejected: number; hired: number };

const WEEK_MS = 7 * 86_400_000;

export function weeklyMomentum(
  events: MomentumEvent[],
  opts?: { weeks?: number; now?: number }
): MomentumWeek[] {
  const weeks = Math.max(1, opts?.weeks ?? MOMENTUM_WEEKS);
  const now = opts?.now ?? Date.now();
  const start = now - weeks * WEEK_MS;
  const buckets: MomentumWeek[] = Array.from({ length: weeks }, (_, i) => ({
    weekStart: new Date(start + i * WEEK_MS).toISOString().slice(0, 10),
    added: 0,
    advanced: 0,
    rejected: 0,
    hired: 0,
  }));
  for (const e of events) {
    const ms = Date.parse(e.createdAt);
    // Malformed timestamps and events outside the span are skipped, not thrown:
    // one legacy row must not blank the whole panel.
    if (!Number.isFinite(ms) || ms < start || ms >= now + 1) continue;
    const idx = Math.min(weeks - 1, Math.floor((ms - start) / WEEK_MS));
    const b = buckets[idx];
    if (e.kind === "added" || e.kind === "intake_degraded") b.added += 1;
    else if ((e.kind === "advanced" || e.kind === "auto_advanced") && e.toStage === "Hired") b.hired += 1;
    else if (e.kind === "advanced" || e.kind === "auto_advanced") b.advanced += 1;
    else if (e.kind === "rejected" || e.kind === "auto_rejected") b.rejected += 1;
  }
  return buckets;
}
