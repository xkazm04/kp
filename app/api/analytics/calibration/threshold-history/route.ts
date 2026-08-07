import { NextResponse } from "next/server";
import { pipelineCalibrationPairs } from "@/app/_lib/db/pipeline";
import { listDecisionRecords } from "@/app/_lib/decision-record-store";
import { computeThresholdEffect } from "@/app/_lib/calibration";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonError } from "@/app/_lib/api-response";


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

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function GET(request: Request) {
  try {
    const ws = await currentWorkspace();
    const family = new URL(request.url).searchParams.get("roleFamily") || null;

    // The sealed threshold-adjust records for THIS workspace's chain, newest first.
    const records = listDecisionRecords({ workspaceId: ws }).filter((r) => r.kind === "screening_threshold_adjusted");
    const history: HistoryPoint[] = [];
    for (const r of records) {
      let inputs: SealInputs = {};
      try {
        inputs = ((JSON.parse(r.payloadJson) as { inputs?: unknown })?.inputs ?? {}) as SealInputs;
      } catch {
        continue; // a record whose payload won't parse is skipped, never guessed
      }
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
