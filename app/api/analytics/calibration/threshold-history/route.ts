import { NextResponse } from "next/server";
import { pipelineCalibrationPairs } from "@/app/_lib/db/pipeline";
import { listDecisionRecords, type DecisionRecord } from "@/app/_lib/decision-record-store";
import { computeThresholdEffect } from "@/app/_lib/calibration";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonError, jsonRefusal } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { safeRowParse } from "@/app/_lib/db/core";


// threshold-story — the floor-over-time strip + the "since last change" effect
// line for the calibration panel. Reads the SAME sealed `screening_threshold_adjusted`
// records the /apply-threshold route writes (no new store) plus the workspace's
// calibration pairs, and measures the LAST apply's effect on the band it targeted,
// honesty-gated on decisions-since. Read-only.
//
// NOT operator-gated (unlike /api/decisions/records, which reads the WHOLE chain
// carrying candidate refs + adverse-action rationales): this endpoint returns ONLY
// policy-level threshold seals (candidateRef is a "policy:screening:*" string, no
// candidate PII) and aggregate band rates, workspace-scoped — the same exposure
// class as the sibling /calibration and /calibration/band reads it sits beside.
//
// ?roleFamily= scopes to that family's applies + that family's pairs; absent → the
// GLOBAL applies (records with no family) + the unfiltered pairs. So the panel's
// family selector threads straight through, and a global change never shows under a
// family filter (nor vice-versa).
type SealInputs = {
  direction?: unknown;
  band?: { lo?: unknown; hi?: unknown };
  n?: unknown;
  advanceRatePct?: unknown;
  suggestedThreshold?: unknown;
  previousThreshold?: unknown;
  currentThreshold?: unknown;
  approvedBy?: unknown;
  roleFamily?: unknown;
};

type HistoryPoint = {
  seq: number;
  contentHash: string;
  at: string;
  approvedBy: string | null;
  direction: "lower" | "raise" | null;
  previous: number | null;
  next: number | null;
  band: { lo: number; hi: number } | null;
  n: number | null;
  advanceRatePct: number | null;
  roleFamily: string | null;
};

// THROTTLE (2026-09-03). Deliberately NOT role-gated - the justification above stands -
// but "no role gate" is exactly why it needs a budget: two 200-record chain reads plus a
// full calibration scan and an effect computation, per hit, from any valid session (and
// from anyone at all in open mode). 60/10min per IP sits far above the panel, which
// fetches once per family switch.
const HISTORY_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function GET(request: Request) {
  try {
    const family = new URL(request.url).searchParams.get("roleFamily") || null;
    if (!rateLimit(`threshold-history:${clientIpFrom(request.headers)}`, HISTORY_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const ws = await currentWorkspace();

    // The sealed threshold-adjust records for THIS workspace's chain, newest first.
    //
    // READ THE POLICY REF, not the tail of the whole chain. `listDecisionRecords({
    // workspaceId })` returns the newest 200 records of ANY kind (its `limit` default), and
    // the chain fills with one seal per consequential CANDIDATE decision — so on any
    // workspace that has run a few screening waves the threshold seals fall off the end and
    // this strip renders empty, `effect` goes null, and a floor change that is still in
    // force reads as "never happened" on the surface built to audit it. /apply-threshold
    // seals every change under a deterministic policy ref (`policy:screening:<ws>` globally,
    // `…:<family>` when scoped), so asking for that ref is dilution-proof: the 200 are 200
    // threshold changes, not 200 anything-elses.
    //
    // The workspace-wide read is kept as a compatibility net for a record sealed under some
    // other ref shape; the two are merged and de-duplicated on `seq`, then re-sorted newest
    // first (so `history[0]` is still the latest apply, which `effect` measures against).
    const policyRef = family ? `policy:screening:${ws}:${family}` : `policy:screening:${ws}`;
    const bySeq = new Map<number, DecisionRecord>();
    for (const r of [...listDecisionRecords({ candidateRef: policyRef, workspaceId: ws }), ...listDecisionRecords({ workspaceId: ws })]) {
      if (r.kind === "screening_threshold_adjusted") bySeq.set(r.seq, r);
    }
    const records = [...bySeq.values()].sort((a, b) => b.seq - a.seq);
    const history: HistoryPoint[] = [];
    for (const r of records) {
      // Decode at the shared seam (safeRowParse): a record whose payload won't parse
      // is still skipped, never guessed — but the skip is recorded in the row-health
      // ledger instead of vanishing silently in a bare catch.
      const payload = safeRowParse<{ inputs?: unknown }>(r.payloadJson, "thresholdHistory.payload", String(r.seq));
      if (!payload) continue;
      const inputs = (payload.inputs ?? {}) as SealInputs;
      const recFamily = typeof inputs.roleFamily === "string" && inputs.roleFamily ? inputs.roleFamily : null;
      // Family filter: a family view shows only that family's applies; the all-families
      // (global) view shows only the global (family-less) applies. No cross-bleed.
      if (family ? recFamily !== family : recFamily !== null) continue;
      const band =
        inputs.band && num(inputs.band.lo) != null && num(inputs.band.hi) != null
          ? { lo: num(inputs.band.lo)!, hi: num(inputs.band.hi)! }
          : null;
      history.push({
        seq: r.seq,
        contentHash: r.contentHash,
        at: r.createdAt,
        approvedBy: typeof inputs.approvedBy === "string" ? inputs.approvedBy : null,
        direction: inputs.direction === "lower" || inputs.direction === "raise" ? inputs.direction : null,
        previous: num(inputs.previousThreshold) ?? num(inputs.currentThreshold),
        next: num(inputs.suggestedThreshold),
        band,
        n: num(inputs.n),
        advanceRatePct: num(inputs.advanceRatePct),
        roleFamily: recFamily,
      });
    }

    // The "since last change" effect: measured against the MOST RECENT apply's band,
    // over the (family-scoped) calibration pairs. Null when there is no apply yet, or
    // the last apply sealed no band to examine.
    const latest = history[0];
    const allPairs = pipelineCalibrationPairs(ws);
    const pairs = family ? allPairs.filter((p) => p.roleFamily === family) : allPairs;
    const effect = latest && latest.band ? computeThresholdEffect(pairs, latest.band, latest.at) : null;

    return NextResponse.json({ history, effect });
  } catch (error) {
    return jsonError(error, "Failed to load the threshold history.");
  }
}
