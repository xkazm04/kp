import {
  GIG_ARENAS,
  GIG_DISCLOSURE_ITEM,
  GIG_KPI_SMALL_SAMPLE,
  type Gig,
  type GigArena,
  type GigAttempt,
  type GigKpi,
  type GigKpiCell,
  type GigOutcome,
  type GigSpecialist,
} from "./types";

// The Gigs KPI as a PURE fold: rows in, GigKpi out. No db import and no clock of its own
// (`now` is an input), so the arithmetic is testable against a hand-counted fixture and
// the store (db/gigs-outcomes.ts readGigKpiInput) only has to gather rows.
//
// The rules, stated once:
//  - An attempt counts toward resolved/pending only once it was SENT (status 'sent').
//  - A sent attempt's verdict is its LATEST outcome (recordedAt, then input order). An
//    outcome recorded with attemptId null belongs to its gig's latest sent attempt
//    (sentAt, then createdAt, then id); an outcome that cannot be attributed to a sent
//    attempt of a known gig is ignored rather than guessed onto one.
//  - resolved = sent attempts WITH a verdict. `no_response` is a verdict: the operator
//    stopped waiting, so it is resolved and not accepted. pending = sent without one.
//  - rate = accepted / resolved, null at resolved 0 (unmeasured is never 0%).
//  - Cost reads EVERY attempt of the cell (failed and discarded runs cost money too):
//    costPerAcceptedUsd = sum of the reported costs / accepted, null when nothing was
//    accepted or no attempt reported a cost; costUnreported counts attempts whose
//    costUsd is null (a lower-bound honesty count, never read as free).
//  - disclosureRate = sent attempts whose review ticked the disclosure item / sent
//    attempts, null when nothing was sent.

export type GigKpiAttemptRow = Pick<
  GigAttempt,
  "id" | "gigId" | "specialistId" | "status" | "costUsd" | "review" | "sentAt" | "createdAt"
>;
export type GigKpiOutcomeRow = Pick<GigOutcome, "id" | "gigId" | "attemptId" | "verdict" | "recordedAt">;
export type GigKpiGigRow = Pick<Gig, "id" | "arena">;
export type GigKpiSpecialistRow = Pick<GigSpecialist, "id">;

export type GigKpiInput = {
  attempts: readonly GigKpiAttemptRow[];
  outcomes: readonly GigKpiOutcomeRow[];
  gigs: readonly GigKpiGigRow[];
  specialists: readonly GigKpiSpecialistRow[];
  /** ISO timestamp stamped as `computedAt`. */
  now: string;
};

type Acc = {
  resolved: number;
  accepted: number;
  pending: number;
  costSum: number;
  costReported: number;
  costUnreported: number;
};

function emptyAcc(): Acc {
  return { resolved: 0, accepted: 0, pending: 0, costSum: 0, costReported: 0, costUnreported: 0 };
}

function toCell(a: Acc): GigKpiCell {
  return {
    resolved: a.resolved,
    accepted: a.accepted,
    rate: a.resolved === 0 ? null : a.accepted / a.resolved,
    pending: a.pending,
    costPerAcceptedUsd: a.accepted === 0 || a.costReported === 0 ? null : a.costSum / a.accepted,
    costUnreported: a.costUnreported,
    smallSample: a.resolved < GIG_KPI_SMALL_SAMPLE,
  };
}

/** Sort key for "the gig's latest sent attempt". */
function sentOrder(a: GigKpiAttemptRow): string {
  return `${a.sentAt ?? ""}\u0000${a.createdAt}\u0000${a.id}`;
}

export function foldGigKpi(input: GigKpiInput): GigKpi {
  const arenaOfGig = new Map<string, GigArena>();
  for (const g of input.gigs) arenaOfGig.set(g.id, g.arena);

  const attemptById = new Map<string, GigKpiAttemptRow>();
  const latestSentByGig = new Map<string, GigKpiAttemptRow>();
  for (const a of input.attempts) {
    attemptById.set(a.id, a);
    if (a.status !== "sent") continue;
    const prev = latestSentByGig.get(a.gigId);
    if (!prev || sentOrder(a) > sentOrder(prev)) latestSentByGig.set(a.gigId, a);
  }

  // Latest verdict per sent attempt. Ties on recordedAt resolve to the later input row.
  const verdictOf = new Map<string, { verdict: GigOutcome["verdict"]; recordedAt: string }>();
  for (const o of input.outcomes) {
    if (!arenaOfGig.has(o.gigId)) continue;
    let target: GigKpiAttemptRow | undefined;
    if (o.attemptId !== null) {
      const a = attemptById.get(o.attemptId);
      target = a && a.status === "sent" && a.gigId === o.gigId ? a : undefined;
    } else {
      target = latestSentByGig.get(o.gigId);
    }
    if (!target) continue;
    const prev = verdictOf.get(target.id);
    if (!prev || o.recordedAt >= prev.recordedAt) verdictOf.set(target.id, { verdict: o.verdict, recordedAt: o.recordedAt });
  }

  const byArena = new Map<GigArena, Acc>(GIG_ARENAS.map((a) => [a, emptyAcc()]));
  const bySpecialist = new Map<string, Acc>(input.specialists.map((s) => [s.id, emptyAcc()]));

  let sent = 0;
  let disclosed = 0;
  for (const a of input.attempts) {
    const cells: Acc[] = [];
    const arena = arenaOfGig.get(a.gigId);
    if (arena) cells.push(byArena.get(arena)!);
    let spec = bySpecialist.get(a.specialistId);
    if (!spec) {
      // An attempt by a specialist no longer listed still counts: its numbers do not vanish.
      spec = emptyAcc();
      bySpecialist.set(a.specialistId, spec);
    }
    cells.push(spec);

    const isSent = a.status === "sent";
    const verdict = isSent ? verdictOf.get(a.id)?.verdict : undefined;
    if (isSent) {
      sent += 1;
      if (a.review?.checklist?.[GIG_DISCLOSURE_ITEM] === true) disclosed += 1;
    }
    for (const c of cells) {
      if (a.costUsd === null || !Number.isFinite(a.costUsd)) c.costUnreported += 1;
      else {
        c.costSum += a.costUsd;
        c.costReported += 1;
      }
      if (!isSent) continue;
      if (verdict === undefined) c.pending += 1;
      else {
        c.resolved += 1;
        if (verdict === "accepted") c.accepted += 1;
      }
    }
  }

  const arenaCells = {} as Record<GigArena, GigKpiCell>;
  for (const arena of GIG_ARENAS) arenaCells[arena] = toCell(byArena.get(arena)!);
  const specialistCells: Record<string, GigKpiCell> = {};
  for (const [id, acc] of bySpecialist) specialistCells[id] = toCell(acc);

  return {
    byArena: arenaCells,
    bySpecialist: specialistCells,
    disclosureRate: sent === 0 ? null : disclosed / sent,
    computedAt: input.now,
  };
}
