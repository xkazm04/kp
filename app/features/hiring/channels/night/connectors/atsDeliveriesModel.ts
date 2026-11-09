/*
 * The outbound ATS delivery ledger, as the deck reads it (pure; pinned by atsDeliveries.test.ts).
 *
 * GET /api/ats/deliveries (app/api/ats/deliveries/route.ts, used as it is) answers the recent
 * rows and three counts: `due` (a retry is scheduled), `dead` (failed with no next attempt: the
 * ladder gave up, the outcome never reached the ATS) and `stranded` (an attempt whose process
 * ended without an outcome; the next sweep reclaims it). Replay is the route's own
 * POST { replayId }: it requeues one dead row under the same ledger id, then sweeps.
 *
 * A dead row is the one thing here a recruiter must hear about without opening a level, so the
 * count also becomes a need on the plumbing (channelsNightPlumbing.rankNeeds, `atsDead`).
 */

export type AtsDeliveryWire = {
  id: number;
  event: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  updatedAt: string | null;
};

export type AtsDeliveries = { due: number; dead: number; stranded: number; rows: AtsDeliveryWire[] };

/** The counts the plumbing ranks (no rows: level 0 never lists them). */
export type AtsDeliveryCounts = Pick<AtsDeliveries, "due" | "dead" | "stranded">;

const STATUSES: readonly string[] = ["pending", "delivered", "failed"];
const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

/** One GET body -> the ledger, or null when it is not one (a refusal, an older server). */
export function parseDeliveriesBody(body: unknown): AtsDeliveries | null {
  const d = body as { deliveries?: unknown; due?: unknown; dead?: unknown; stranded?: unknown } | null;
  const due = count(d?.due);
  const dead = count(d?.dead);
  if (!d || due === null || dead === null || !Array.isArray(d.deliveries)) return null;
  const rows: AtsDeliveryWire[] = [];
  for (const raw of d.deliveries) {
    const r = raw as Partial<AtsDeliveryWire> | null;
    if (!r || !Number.isInteger(r.id) || typeof r.status !== "string" || !STATUSES.includes(r.status)) continue;
    rows.push({
      id: r.id as number,
      event: typeof r.event === "string" ? r.event : "",
      status: r.status as AtsDeliveryWire["status"],
      attempts: count(r.attempts) ?? 0,
      lastStatus: typeof r.lastStatus === "number" ? r.lastStatus : null,
      lastError: typeof r.lastError === "string" ? r.lastError : null,
      nextAttemptAt: typeof r.nextAttemptAt === "string" ? r.nextAttemptAt : null,
      updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
    });
  }
  return { due, dead, stranded: count(d.stranded) ?? 0, rows };
}

/** Dead-lettered: failed with no next attempt. Exactly the rows the route's replay accepts. */
export function isDeadDelivery(row: AtsDeliveryWire): boolean {
  return row.status === "failed" && row.nextAttemptAt === null;
}

export function deadDeliveries(d: AtsDeliveries): AtsDeliveryWire[] {
  return d.rows.filter(isDeadDelivery);
}

export function deliveryCounts(d: AtsDeliveries | null): AtsDeliveryCounts | null {
  return d ? { due: d.due, dead: d.dead, stranded: d.stranded } : null;
}

/** The route's replay request, unchanged: POST { replayId }. */
export function replayRequest(id: number): { url: string; init: RequestInit } {
  return {
    url: "/api/ats/deliveries",
    init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ replayId: id }) },
  };
}
