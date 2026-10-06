// The pure half of scripts/kpi/role-demo-run.mjs: a demo run's ledger in, a reading out.
//
// It imports nothing and opens nothing, so the headline rules are unit-testable without a
// database. The script owns the copy, the engine loop and the printing; this owns what the
// ledger MEANS — which branches are parked where, how far the run got, and when the honest
// answer is "not measured".

/** The seven artifact kinds in ladder order — role-run-stages.ts ROLE_RUN_STAGES. Restated
 *  rather than imported so this file stays loadable without the TS transform; the script
 *  passes the live list in, and the test pins that the two agree. */
export const STAGE_ORDER = ["role_spec", "slate", "screen", "case_assignment", "interview", "scorecard", "offer_draft"];

/** The three human gates and the stage each one parks — role-run-gates.ts GATE_STAGE. */
export const GATE_OF_STAGE = { screen: "rejection", interview: "interview_invite", offer_draft: "offer" };

/**
 * @param {{
 *   runStatus: string,
 *   artifacts: { kind: string, branchRef: string|null, status: string, seq: number, payload?: unknown }[],
 *   blocked?: { stage: string, needs: string } | null,
 *   failure?: string | null,
 * }} input
 * @returns {{
 *   measured: boolean, headline: string, reason: string | null, furthest: string | null,
 *   produced: { kind: string, branchRef: string|null, status: string }[],
 *   branches: number, parked: { gate: string, kind: string, branchRef: string }[],
 *   parkedByGate: Record<string, string[]>,
 * }}
 */
export function summarizeRoleDemoRun({ runStatus, artifacts, blocked = null, failure = null }) {
  const ordered = [...artifacts].sort((a, b) => a.seq - b.seq);
  const produced = ordered.map((a) => ({ kind: a.kind, branchRef: a.branchRef, status: a.status }));

  // A branch is parked when the newest artifact on its chain is awaiting a human.
  const latestByBranch = new Map();
  for (const a of ordered) if (a.branchRef !== null) latestByBranch.set(a.branchRef, a);
  const parked = [];
  for (const [branchRef, a] of latestByBranch) {
    if (a.status === "awaiting_approval" && GATE_OF_STAGE[a.kind]) parked.push({ gate: GATE_OF_STAGE[a.kind], kind: a.kind, branchRef });
  }
  const parkedByGate = {};
  for (const p of parked) (parkedByGate[p.gate] ??= []).push(p.branchRef);

  const rank = (kind) => STAGE_ORDER.indexOf(kind);
  const furthest = ordered.reduce((best, a) => (rank(a.kind) > rank(best ?? "") ? a.kind : best), /** @type {string|null} */ (null));

  const slate = [...ordered].reverse().find((a) => a.kind === "slate" && a.branchRef === null && a.status === "complete");
  const slateSize = Array.isArray(slate?.payload?.candidates) ? slate.payload.candidates.length : null;
  const spec = ordered.find((a) => a.kind === "role_spec" && a.status === "terminal");
  const specFindings = Array.isArray(spec?.payload?.lintFindings) ? spec.payload.lintFindings : [];

  const base = { produced, branches: latestByBranch.size, parked, parkedByGate, furthest };
  const notMeasured = (reason) => ({ ...base, measured: false, reason, headline: `not measured: ${reason}` });

  // Order matters: the most specific cause first, so a cancelled run names WHY it was cancelled.
  if (failure) return notMeasured(failure);
  if (blocked) return notMeasured(`${blocked.stage} needs ${blocked.needs}`);
  if (runStatus === "cancelled") return notMeasured(specFindings.length > 0 ? `run cancelled (${specFindings.join(", ")})` : "run cancelled");
  if (ordered.length === 0) return notMeasured("no stage produced an artifact");
  if (slate && slateSize === 0) return notMeasured("no slate formed (0 candidates on the board for this job)");
  if (latestByBranch.size === 0) return notMeasured("no candidate branch formed");

  const gates = Object.keys(parkedByGate);
  const tail = parked.length > 0 ? `${parked.length} branch${parked.length === 1 ? "" : "es"} parked at gates ${gates.join(", ")}` : "0 branches parked at gates";
  return { ...base, measured: true, reason: null, headline: `reached ${furthest}; ${tail}` };
}

/** Who signs a gate in a demo run that was told to pass them — the approver name the demo
 *  hands commitRoleRunStageGate, and the label every reading prints. It is a stand-in on the
 *  throwaway copy, never a person (ADR-0011 amendment 2026-10-06). */
export const STAND_IN_APPROVER = "demo-stand-in";

/** The goal-1 headline, from roleRunGoalOneSteps (app/_lib/role-run-metrics.ts) and the reading
 *  above. A run that could not be read at all keeps its own "not measured: <reason>" — the
 *  cause, not the ledger's emptiness; otherwise the verdict leads. Operator's decision of
 *  2026-10-06 (ADR-0011 amendment): the three approval gates are allowed steps, so a run
 *  that stops at one is "not met", with the gate named, rather than a failure of autonomy.
 *
 *  `standIn` is non-null only when the demo was run with --approve-gates: the verdict then
 *  says, in the same line, that the gates were approved by the demo stand-in and not by a
 *  person. Counts per gate follow in standInLine.
 *
 *  @param {{ verdict: string, reason: string|null }} goalOne
 *  @param {{ measured: boolean, headline: string }} reading
 *  @param {Record<string, number> | null} [standIn] */
export function goalOneHeadline(goalOne, reading, standIn = null) {
  const tag = standIn ? " (gates approved by demo stand-in)" : "";
  if (!reading.measured) return reading.headline;
  if (goalOne.verdict === "met") return `goal 1: met${tag}`;
  if (goalOne.verdict === "not measured") return `not measured: ${goalOne.reason}`;
  return `goal 1: not met: ${goalOne.reason}${tag}`;
}

/** The count of stand-in approvals per gate, as a line that says whose approvals they are.
 *  @param {Record<string, number>} counts */
export function standInLine(counts) {
  return `gates approved by the demo stand-in, not a person: ${formatGateCounts(counts)}`;
}

/** The ladder stages the run reached, each with how many chains hold an artifact of it —
 *  distinct branches, the run-wide stages counting as one — in ladder order.
 *  @param {{ kind: string, branchRef: string|null }[]} artifacts
 *  @returns {{ kind: string, chains: number }[]} */
export function stagesReached(artifacts) {
  const chains = new Map();
  for (const a of artifacts) {
    if (!STAGE_ORDER.includes(a.kind)) continue;
    if (!chains.has(a.kind)) chains.set(a.kind, new Set());
    chains.get(a.kind).add(a.branchRef ?? "");
  }
  return STAGE_ORDER.filter((k) => chains.has(k)).map((kind) => ({ kind, chains: chains.get(kind).size }));
}

/** Where the run stopped, in one clause.
 *  @param {{ runStatus: string, parkedByGate: Record<string, string[]>, failure?: string|null, capped?: boolean }} input */
export function stoppedAt({ runStatus, parkedByGate, failure = null, capped = false }) {
  if (failure) return failure;
  if (capped) return "the pass ceiling, with the run still running";
  const parked = Object.entries(parkedByGate).map(([gate, refs]) => `${gate} (${refs.length})`);
  if (parked.length > 0) return `awaiting approval at ${parked.join(", ")}`;
  if (runStatus === "complete") return "run complete: every branch ended";
  if (runStatus === "cancelled") return "run cancelled";
  return "nothing left to produce";
}

/** Per-gate counts as text, in gate order, e.g. "rejection 20 · interview_invite 0 · offer 0".
 *  @param {Record<string, number>} counts */
export function formatGateCounts(counts) {
  return Object.entries(counts).map(([gate, n]) => `${gate} ${n}`).join(" · ");
}

/** A coverage row as text. A row with nothing to divide is "n/a", never a percentage. */
export function formatCoverage(row) {
  if (!row || row.total === 0 || row.coverage === null) return "n/a (0 artifacts)";
  return `${row.autonomousComplete}/${row.total} (${Math.round(row.coverage * 100)}%)`;
}
