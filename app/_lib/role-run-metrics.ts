// Coverage and gate dwell, read off the role-run ledger. Idea 82dfc562; the two figures
// ADR-0011 §Consequences says the goal is measured by:
//
//   "the KPI must be autonomous-stage coverage and gate dwell time separately, never a
//    single 'time to hire' that hides which half is slow."
//
// So this module exports TWO functions for those figures and none that folds them together. Coverage
// says how much of the ledger the machine produced without a person; dwell says how long
// the people it waited for took. A reader who wants one number has to say which half.
//
// Pure over RoleRunStageArtifact[] (db/role-runs.ts listStageArtifacts) — structurally, so
// this module stays DB-free. The ledger is the only input: nothing is inferred from
// pipeline_events, and nothing is read from the clock. A third export, roleRunGoalOneSteps,
// answers a different question (goal 1: gate approvals counted apart from human steps) and
// leaves both figures above exactly as they were.

import { GATE_STAGE, ROLE_RUN_GATES, isRoleRunGate, type RoleRunGate } from "./role-run-gates.ts";
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

// --- GOAL 1: GATE APPROVALS APART FROM HUMAN STEPS ----------------------------------
//
// ADR-0011 amendment 2026-10-06 (the operator's decision, ask 47725201): goal 1 is one role
// running end to end with ZERO human steps apart from the three Art. 22 approval gates. The
// gates stay human — a run still stops at each for one attributable approval act, and
// `gateDwell` still reports that wait — but an approval at a gate is an ALLOWED step, so the
// goal-1 reading counts it apart instead of folding it into "a human step". `roleRunCoverage`
// keeps treating a gated stage's `complete` as human, on purpose: that is the autonomous-
// coverage figure, a different question from this one.

/** A ledger row with its payload — the one extra field the gate read needs, because the
 *  only record of WHICH gate a row resolved, and how, is `payload.gate` / `payload.decision`
 *  (role-run-engine.ts commitRoleRunStageGate). */
export type GoalOneArtifact = MetricArtifact & { payload?: unknown };

export type GateTally = { approved: number; declined: number };

export type GoalOneVerdict = "met" | "not met" | "not measured";

export type GoalOneSteps = {
  /** Resolved gates, per gate, split by the decision the commit recorded. These are the
   *  allowed human acts — counted here, never as a human step. */
  gateApprovals: Record<RoleRunGate, GateTally>;
  /** `awaiting_approval` rows nothing has resolved yet, per gate. */
  openGates: Record<RoleRunGate, number>;
  /** Ledger rows that record a human act other than a gate commit: a row that resolves a
   *  parked chain without a gate payload that names that stage's own gate and a recognised
   *  decision. The engine writes exactly one kind of human row — the gate commit — so on a
   *  ledger the engine wrote this is 0 by construction; it is here so a second way for a
   *  person to move a branch cannot be added without this goal noticing. */
  humanStepsOutsideGates: number;
  /** `complete` rows produced with no human step outside the gates. A gate resolution that
   *  reads `complete` counts here: it is an allowed approval, not a human step. */
  goalOneComplete: number;
  /** Every row, whatever its status — the denominator for goalOneComplete. */
  total: number;
  verdict: GoalOneVerdict;
  /** Why the verdict is not `met`; null when it is met. */
  reason: string | null;
};

const emptyTally = (): Record<RoleRunGate, GateTally> =>
  Object.fromEntries(ROLE_RUN_GATES.map((g) => [g, { approved: 0, declined: 0 }])) as Record<RoleRunGate, GateTally>;
const emptyOpen = (): Record<RoleRunGate, number> => Object.fromEntries(ROLE_RUN_GATES.map((g) => [g, 0])) as Record<RoleRunGate, number>;

const gateOfKind = (kind: RoleRunStageKind): RoleRunGate | null => ROLE_RUN_GATES.find((g) => GATE_STAGE[g] === kind) ?? null;

/** The gate and decision a resolution row records, or null when it is not a recognisable
 *  gate commit — wrong gate for the stage, no gate, or no decision. */
function gateCommitOf(a: GoalOneArtifact): { gate: RoleRunGate; decision: "approved" | "declined" } | null {
  const p = typeof a.payload === "object" && a.payload !== null ? (a.payload as { gate?: unknown; decision?: unknown }) : null;
  if (!p || !isRoleRunGate(p.gate) || GATE_STAGE[p.gate] !== a.kind) return null;
  return p.decision === "approved" || p.decision === "declined" ? { gate: p.gate, decision: p.decision } : null;
}

/** Goal 1 read off the ledger: how many human steps happened outside the three gates, what
 *  happened AT the gates, and whether one branch got through the offer gate with none.
 *
 *  A resolution row is the first row on the same (kind, branchRef) after an
 *  `awaiting_approval` — the same rule `gateDwell` closes a gate by. An `awaiting_approval`
 *  on a kind that raises no gate is not tallied as an open gate (the engine cannot write
 *  one); its resolution, having no gate to name, falls under humanStepsOutsideGates.
 *
 *  An empty ledger is `not measured`, and no figure here is a percentage: counts over
 *  nothing stay counts. */
export function roleRunGoalOneSteps(artifacts: readonly GoalOneArtifact[]): GoalOneSteps {
  const ordered = [...artifacts].sort((a, b) => a.seq - b.seq);
  const gateApprovals = emptyTally();
  const openGates = emptyOpen();
  const parked = new Set<string>();
  let humanStepsOutsideGates = 0;
  let goalOneComplete = 0;
  let offerResolved = false;

  for (const a of ordered) {
    if (!ROLE_RUN_STAGES.includes(a.kind)) continue; // outside the vocabulary: not a row this read can score
    const key = chainKey(a);
    let outsideGate = false;
    if (parked.has(key) && a.status !== "awaiting_approval") {
      // The first non-parking row after a park is its resolution.
      parked.delete(key);
      const commit = gateCommitOf(a);
      if (commit) {
        gateApprovals[commit.gate][commit.decision] += 1;
        if (commit.gate === "offer" && commit.decision === "approved" && a.status === "complete") offerResolved = true;
      } else {
        humanStepsOutsideGates += 1;
        outsideGate = true;
      }
    }
    if (a.status === "complete" && !outsideGate) goalOneComplete += 1;
    if (a.status === "awaiting_approval") parked.add(key);
  }
  for (const key of parked) {
    const gate = gateOfKind(key.split("\u0000")[0] as RoleRunStageKind);
    if (gate) openGates[gate] += 1;
  }

  const total = ordered.filter((a) => ROLE_RUN_STAGES.includes(a.kind)).length;
  const base = { gateApprovals, openGates, humanStepsOutsideGates, goalOneComplete, total };
  if (total === 0) return { ...base, verdict: "not measured", reason: "no stage produced an artifact" };
  if (humanStepsOutsideGates === 0 && offerResolved) return { ...base, verdict: "met", reason: null };
  if (humanStepsOutsideGates > 0) {
    return { ...base, verdict: "not met", reason: `${humanStepsOutsideGates} human step${humanStepsOutsideGates === 1 ? "" : "s"} outside the gates` };
  }
  const furthestOpen = [...ROLE_RUN_GATES].reverse().find((g) => openGates[g] > 0);
  if (furthestOpen) return { ...base, verdict: "not met", reason: `stopped at the ${furthestOpen} gate: ${openGates[furthestOpen]} awaiting approval (an allowed step)` };
  // No gate open and no offer approved. A declined gate ended its branch by decision, so "no
  // branch reached a resolved offer gate" would be false after a declined offer: say what
  // happened. The verdict stays "not met" - goal 1's end is an approved offer.
  const anyDeclined = ROLE_RUN_GATES.some((g) => gateApprovals[g].declined > 0);
  if (anyDeclined) return { ...base, verdict: "not met", reason: "every open branch ended at a gate by decision; no offer approved" };
  return { ...base, verdict: "not met", reason: "no branch reached a resolved offer gate" };
}
