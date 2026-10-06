// Coverage and gate dwell, read off the role-run ledger. Idea 82dfc562; the two figures
// ADR-0011 §Consequences says the goal is measured by:
//
//   "the KPI must be autonomous-stage coverage and gate dwell time separately, never a
//    single 'time to hire' that hides which half is slow."
//
// So this module exports TWO functions and no third that folds them together. Coverage
// says how much of the ledger the machine produced without a person; dwell says how long
// the people it waited for took. A reader who wants one number has to say which half.
//
// Pure over RoleRunStageArtifact[] (db/role-runs.ts listStageArtifacts) — structurally, so
// this module stays DB-free. The ledger is the only input: nothing is inferred from
// pipeline_events, and nothing is read from the clock.

import { ROLE_RUN_STAGES, stageIsGated, type RoleRunStageKind, type RoleRunStageStatus } from "./role-run-stages.ts";

/** The fields of a ledger row these two reads need. */
export type MetricArtifact = {
  kind: RoleRunStageKind;
  status: RoleRunStageStatus;
  branchRef: string | null;
  seq: number;
  producedAt: string;
};

// --- COVERAGE ---------------------------------------------------------------------

export type CoverageRow = {
  /** Every artifact of this kind, whatever its status — the denominator. */
  total: number;
  /** `complete` artifacts produced with no human gate step in front of them. */
  autonomousComplete: number;
  /** autonomousComplete / total, or null when there is nothing to divide — an empty ledger
   *  has no coverage, it does not have 0% coverage. */
  coverage: number | null;
};

export type RoleRunCoverage = {
  overall: CoverageRow;
  /** One row per stage kind, in ladder order, including kinds with no artifact yet. */
  byKind: Record<RoleRunStageKind, CoverageRow>;
};

function coverageRow(total: number, autonomousComplete: number): CoverageRow {
  return { total, autonomousComplete, coverage: total === 0 ? null : autonomousComplete / total };
}

/** Whether `artifact` is a `complete` row that no person had to commit. A gated stage's
 *  `complete` is the gate's resolution — a human decision by construction — so it is never
 *  autonomous; a complete row that follows an `awaiting_approval` on the same chain is
 *  human for the same reason, whichever stage it is. */
function producedWithoutGate(artifact: MetricArtifact, parkedBefore: ReadonlySet<string>): boolean {
  if (artifact.status !== "complete") return false;
  if (stageIsGated(artifact.kind)) return false;
  return !parkedBefore.has(chainKey(artifact));
}

const chainKey = (a: Pick<MetricArtifact, "kind" | "branchRef">): string => `${a.kind}\u0000${a.branchRef ?? ""}`;

/** Autonomous coverage of a run's ledger: the share of artifacts that are `complete` and
 *  were produced with no human gate step, per stage kind and overall. `awaiting_approval`
 *  and `terminal` rows count in the denominator and never in the numerator — a parked
 *  branch is exactly the thing this number must not hide. */
export function roleRunCoverage(artifacts: readonly MetricArtifact[]): RoleRunCoverage {
  const parked = new Set<string>();
  const totals = Object.fromEntries(ROLE_RUN_STAGES.map((k) => [k, { total: 0, auto: 0 }])) as Record<RoleRunStageKind, { total: number; auto: number }>;
  for (const a of [...artifacts].sort((x, y) => x.seq - y.seq)) {
    const t = totals[a.kind];
    if (!t) continue; // a kind outside the vocabulary is not a ledger row this read can score
    t.total += 1;
    if (producedWithoutGate(a, parked)) t.auto += 1;
    if (a.status === "awaiting_approval") parked.add(chainKey(a));
  }
  const rows = Object.values(totals);
  return {
    overall: coverageRow(
      rows.reduce((n, r) => n + r.total, 0),
      rows.reduce((n, r) => n + r.auto, 0)
    ),
    byKind: Object.fromEntries(ROLE_RUN_STAGES.map((k) => [k, coverageRow(totals[k].total, totals[k].auto)])) as Record<RoleRunStageKind, CoverageRow>,
  };
}

// --- GATE DWELL -------------------------------------------------------------------

export type GateDwellEntry = {
  kind: RoleRunStageKind;
  branchRef: string | null;
  /** The seq of the `awaiting_approval` artifact that parked the branch. */
  parkedSeq: number;
  parkedAt: string;
  /** closed     — a later artifact on the same (kind, branch) resolved the gate.
   *  open       — nothing has resolved it yet; the branch is still parked.
   *  unmeasurable — a resolution exists but the two timestamps do not give a
   *                 non-negative interval, so no duration is claimed. */
  state: "closed" | "open" | "unmeasurable";
  resolvedAt: string | null;
  /** parkedAt -> resolvedAt in ms. null for `open` — NEVER now minus parkedAt: a gate
   *  that has not been decided has no dwell yet, and a figure that grows by itself with
   *  the wall clock would make a stuck branch look like a measurement. */
  dwellMs: number | null;
};

export type GateDwell = {
  entries: GateDwellEntry[];
  closed: number;
  open: number;
  unmeasurable: number;
  /** Median over the CLOSED entries only; null when none closed. */
  medianClosedMs: number | null;
};

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** For each `awaiting_approval` artifact, the interval to the next artifact of the same
 *  (kind, branchRef). Entries come back in ledger order. */
export function gateDwell(artifacts: readonly MetricArtifact[]): GateDwell {
  const ordered = [...artifacts].sort((a, b) => a.seq - b.seq);
  const entries: GateDwellEntry[] = [];
  for (const [i, a] of ordered.entries()) {
    if (a.status !== "awaiting_approval") continue;
    const next = ordered.slice(i + 1).find((b) => b.kind === a.kind && b.branchRef === a.branchRef);
    const base = { kind: a.kind, branchRef: a.branchRef, parkedSeq: a.seq, parkedAt: a.producedAt };
    if (!next) {
      entries.push({ ...base, state: "open", resolvedAt: null, dwellMs: null });
      continue;
    }
    const dwell = Date.parse(next.producedAt) - Date.parse(a.producedAt);
    entries.push(
      Number.isFinite(dwell) && dwell >= 0
        ? { ...base, state: "closed", resolvedAt: next.producedAt, dwellMs: dwell }
        : { ...base, state: "unmeasurable", resolvedAt: next.producedAt, dwellMs: null }
    );
  }
  const closed = entries.filter((e) => e.state === "closed");
  return {
    entries,
    closed: closed.length,
    open: entries.filter((e) => e.state === "open").length,
    unmeasurable: entries.filter((e) => e.state === "unmeasurable").length,
    medianClosedMs: median(closed.map((e) => e.dwellMs as number)),
  };
}
