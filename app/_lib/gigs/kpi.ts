import {
  GIG_ARENAS,
  GIG_DISCLOSURE_ITEM,
  GIG_KPI_SMALL_SAMPLE,
  type Gig,
  type GigArena,
  type GigAttempt,
  type GigKpi,
  type GigKpiCell,
  type GigKpiMoney,
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
//  - moneyWon reads the SAME counted verdict as the rate (a sent attempt's latest one):
//    each `accepted` verdict with an amount adds to its currency's entry, and entries are
//    never added to each other. An accepted verdict with no amount is counted in
//    acceptedWithoutAmount - unknown, never $0.

export type GigKpiAttemptRow = Pick<
  GigAttempt,
  "id" | "gigId" | "specialistId" | "status" | "costUsd" | "review" | "sentAt" | "createdAt"
>;
/** `amount`/`currency` are optional so a caller that only needs the rate can omit
 *  them; an omitted amount reads as "not recorded". */
export type GigKpiOutcomeRow = Pick<GigOutcome, "id" | "gigId" | "attemptId" | "verdict" | "recordedAt"> &
  Partial<Pick<GigOutcome, "amount" | "currency">>;
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
  const verdictOf = new Map<string, { verdict: GigOutcome["verdict"]; recordedAt: string; amount: number | null; currency: string | null }>();
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
    if (!prev || o.recordedAt >= prev.recordedAt) {
      const amount = typeof o.amount === "number" && Number.isFinite(o.amount) ? o.amount : null;
      const currency = typeof o.currency === "string" && o.currency.trim() ? o.currency.trim() : null;
      verdictOf.set(target.id, { verdict: o.verdict, recordedAt: o.recordedAt, amount, currency });
    }
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

  // Money won: the counted verdicts only, so a corrected verdict's old amount is gone.
  const money = new Map<string, GigKpiMoney>();
  let acceptedWithoutAmount = 0;
  for (const v of verdictOf.values()) {
    if (v.verdict !== "accepted") continue;
    if (v.amount === null) {
      acceptedWithoutAmount += 1;
      continue;
    }
    const key = v.currency ?? "";
    const entry = money.get(key) ?? { currency: v.currency, amount: 0, count: 0 };
    entry.amount += v.amount;
    entry.count += 1;
    money.set(key, entry);
  }
  const moneyWon = [...money.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, m]) => m);

  const arenaCells = {} as Record<GigArena, GigKpiCell>;
  for (const arena of GIG_ARENAS) arenaCells[arena] = toCell(byArena.get(arena)!);
  const specialistCells: Record<string, GigKpiCell> = {};
  for (const [id, acc] of bySpecialist) specialistCells[id] = toCell(acc);

  return {
    byArena: arenaCells,
    bySpecialist: specialistCells,
    disclosureRate: sent === 0 ? null : disclosed / sent,
    moneyWon,
    acceptedWithoutAmount,
    computedAt: input.now,
  };
}
