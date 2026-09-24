import { ACTIVE_AGENT_STATUSES, getHiredAgent } from "../db/agents";
import { getGig, setGigQualification, transitionGig } from "../db/gigs";
import { findGigSpecialistForArena } from "../db/gigs-specialists";
import type { Gig, GigQualification, GigSpecialist } from "./types";

// Gig qualification - "is this listing worth a specialist's attempt?" - as deterministic
// arithmetic over five factors. PURE in `qualifyGig` (no db, the clock is passed in);
// `qualifyAndMatch` is the store-backed step the scan calls for each new listing.
//
// No model is involved and none is needed: every factor is a fact about the row. The
// GigQualification type leaves room for an LLM note (`note`, `source: "llm"`); v1 does
// not write one - `note` is null and `source` is "deterministic".
//
// The weights are named so a reader can check the arithmetic against the verdict:
//   arena fit                         +40
//   reward stated with an amount      +20
//   deadline headroom                 +20 at >= 7 days, scaled down to +10 at 2 days,
//                                     +10 (neutral) when no deadline was stated,
//                                     -40 under 2 days, and the score is 0 once passed
//   specialist available              +20
//   suspect (honeypot scan flagged)   score 0, never qualifies
// Without a live specialist in the arena the ceiling is 40 (reward + a comfortable
// deadline), below the threshold: a gig nobody can work is not "qualified".

export const QUALIFY_THRESHOLD = 50;

export const QUALIFY_WEIGHTS = {
  arenaFit: 40,
  rewardKnown: 20,
  deadlineFull: 20,
  deadlineNeutral: 10,
  deadlineRushPenalty: -40,
  specialistAvailable: 20,
} as const;

/** Headroom at or above which the deadline earns its full weight. */
export const DEADLINE_COMFORT_DAYS = 7;
/** Headroom below which the deadline is a heavy penalty (a rushed attempt). */
export const DEADLINE_MIN_HEADROOM_DAYS = 2;

const DAY_MS = 86_400_000;

/** Days from `now` to `deadlineAt`, to one decimal; null when absent or unparseable. */
export function deadlineHeadroomDays(deadlineAt: string | null, now: Date): number | null {
  if (!deadlineAt) return null;
  const t = Date.parse(deadlineAt);
  if (!Number.isFinite(t)) return null;
  return Math.round(((t - now.getTime()) / DAY_MS) * 10) / 10;
}

function deadlinePoints(headroom: number | null): number {
  if (headroom === null) return QUALIFY_WEIGHTS.deadlineNeutral;
  if (headroom < DEADLINE_MIN_HEADROOM_DAYS) return QUALIFY_WEIGHTS.deadlineRushPenalty;
  if (headroom >= DEADLINE_COMFORT_DAYS) return QUALIFY_WEIGHTS.deadlineFull;
  const span = DEADLINE_COMFORT_DAYS - DEADLINE_MIN_HEADROOM_DAYS;
  const frac = (headroom - DEADLINE_MIN_HEADROOM_DAYS) / span;
  return QUALIFY_WEIGHTS.deadlineNeutral + frac * (QUALIFY_WEIGHTS.deadlineFull - QUALIFY_WEIGHTS.deadlineNeutral);
}

export type QualifyContext = {
  /** The specialist the gig would go to; null when none is available. */
  specialist: GigSpecialist | null;
  now: Date;
};

/** The deterministic verdict. Pure. */
export function qualifyGig(gig: Pick<Gig, "arena" | "reward" | "deadlineAt" | "status" | "suspectReasons">, ctx: QualifyContext): GigQualification {
  const suspect = gig.status === "suspect" || gig.suspectReasons.length > 0;
  const arenaFit = ctx.specialist !== null && ctx.specialist.spec.arena === gig.arena;
  const rewardKnown = gig.reward !== null && typeof gig.reward.amount === "number" && Number.isFinite(gig.reward.amount) && gig.reward.amount > 0;
  const headroom = deadlineHeadroomDays(gig.deadlineAt, ctx.now);
  const specialistAvailable = ctx.specialist !== null;
  const factors: GigQualification["factors"] = { arenaFit, rewardKnown, deadlineHeadroomDays: headroom, specialistAvailable, suspect };

  let score = 0;
  // A suspect listing and a deadline already passed both answer 0: neither is a matter of
  // degree, and a positive number next to either would read as "almost worth it".
  if (!suspect && !(headroom !== null && headroom < 0)) {
    score =
      (arenaFit ? QUALIFY_WEIGHTS.arenaFit : 0) +
      (rewardKnown ? QUALIFY_WEIGHTS.rewardKnown : 0) +
      deadlinePoints(headroom) +
      (specialistAvailable ? QUALIFY_WEIGHTS.specialistAvailable : 0);
  }
  return {
    score: Math.round(Math.min(100, Math.max(0, score))),
    factors,
    note: null,
    source: "deterministic",
    fallbackReason: null,
  };
}

/** Whether a verdict clears the bar. A suspect gig never does, whatever the number. */
export function qualifies(q: GigQualification): boolean {
  return !q.factors.suspect && q.score >= QUALIFY_THRESHOLD;
}

export type QualifyAndMatchResult =
  | { ok: true; gig: Gig; qualification: GigQualification; specialistId: string | null; moved: boolean }
  | { ok: false; reason: "not_found" | "not_qualifiable" };

/** The statuses whose verdict this step writes. A gig past `new` has already been
 *  qualified (or declined, or worked); re-scoring it would rewrite history. `suspect`
 *  gets its (zero) verdict recorded so the desk can show why it is held. */
const QUALIFIABLE: readonly Gig["status"][] = ["new", "suspect"];

/** Find the arena's specialist, record the verdict, and move `new -> qualified` when it
 *  clears QUALIFY_THRESHOLD (otherwise the gig stays `new` for the operator to decide).
 *  A specialist whose hire is no longer live (failed, rejected, retired) is not a match.
 *  Synchronous: every step is a local store call, no await, no transaction spanning a
 *  slow call. The move is a CAS - a gig that moved meanwhile keeps its verdict and
 *  reports `moved: false`. */
export function qualifyAndMatch(workspaceId: string, gigId: string, opts: { now?: Date } = {}): QualifyAndMatchResult {
  const gig = getGig(workspaceId, gigId);
  if (!gig) return { ok: false, reason: "not_found" };
  if (!QUALIFIABLE.includes(gig.status)) return { ok: false, reason: "not_qualifiable" };
  const candidate = findGigSpecialistForArena(workspaceId, gig.arena, gig.niche);
  const agent = candidate ? getHiredAgent(candidate.hiredAgentId, workspaceId) : null;
  const specialist = candidate && agent && ACTIVE_AGENT_STATUSES.includes(agent.status) ? candidate : null;
  const qualification = qualifyGig(gig, { specialist, now: opts.now ?? new Date() });
  const recorded = setGigQualification(workspaceId, gigId, qualification, specialist?.id ?? null) ?? gig;
  if (gig.status !== "new" || !qualifies(qualification)) {
    return { ok: true, gig: recorded, qualification, specialistId: specialist?.id ?? null, moved: false };
  }
  const moved = transitionGig(workspaceId, gigId, { from: "new", to: "qualified" });
  return {
    ok: true,
    gig: moved.ok ? moved.gig : recorded,
    qualification,
    specialistId: specialist?.id ?? null,
    moved: moved.ok,
  };
}

/** The hook the scan (scan.ts `GigScanDeps.qualify`) calls per upserted listing still
 *  `new`. It takes the gig row (scan.ts's shape) or a bare id, so it is assignable to
 *  the scan's hook type without this module importing the adapter graph. The verdict is
 *  re-read from the store, never from the row handed in. */
export function qualifyGigHook(workspaceId: string, gig: string | Pick<Gig, "id">): QualifyAndMatchResult {
  return qualifyAndMatch(workspaceId, typeof gig === "string" ? gig : gig.id);
}
