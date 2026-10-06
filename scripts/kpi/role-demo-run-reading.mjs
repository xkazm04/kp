// The pure half of scripts/kpi/role-demo-run.mjs: a demo run's ledger in, a reading out.
//
// It imports nothing and opens nothing, so the headline rules are unit-testable without a
// database. The script owns the copy, the engine loop and the printing; this owns what the
// ledger MEANS — which branches are parked where, how far the run got, what the gate stand-in
// may decide, and when the honest answer is "not measured".

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

/** The two ways the demo can be told to pass gates. `policy` (--approve-gates) applies
 *  standInDecision and is the only mode whose reading can count for goal 1; `all`
 *  (--approve-all) approves every parked branch with no policy and is mechanics only. */
export const STAND_IN_MODES = ["policy", "all"];

/** The recommendation values on a scorecard card that count as a positive basis for an offer.
 *  The vocabulary is interview-recommendation.ts (advance | hold | reject); the engine's own
 *  scorecard runner writes "unrated" when no interview session exists. */
export const POSITIVE_RECOMMENDATIONS = ["advance"];

/**
 * THE STAND-IN'S POLICY: what the demo does at one parked gate. It carries out the engine's
 * own recorded proposal and adds no judgment of its own — it approves where the record
 * proposes it, declines where the record gives no basis, and never decides a hold, because
 * the repo's fairness rule reserves that judgment for a person (ADR-0011 amendment
 * 2026-10-06).
 *
 *   rejection        advance → approve · reject_proposed → approve (the engine defines
 *                    approving the proposal; the branch ends) · hold → leave
 *   interview_invite approve only when the screen routed advance, else leave
 *   offer            approve only on a positive scorecard recommendation, else decline
 *
 * `leave` resolves nothing: the branch stays parked for a person.
 *
 * @param {{ gate: string, screenRoute?: string|null, scorecardRecommendation?: string|null }} input
 * @returns {{ action: "approve" | "decline" | "leave", reason: string }}
 */
export function standInDecision({ gate, screenRoute = null, scorecardRecommendation = null }) {
  if (gate === "rejection") {
    if (screenRoute === "advance") return { action: "approve", reason: "screen routed advance (score at or above the floor)" };
    if (screenRoute === "reject_proposed") return { action: "approve", reason: "approving the engine's proposed rejection" };
    if (screenRoute === "hold") return { action: "leave", reason: "score below floor" };
    return { action: "leave", reason: "no recorded screen route" };
  }
  if (gate === "interview_invite") {
    if (screenRoute === "advance") return { action: "approve", reason: "screen routed advance" };
    return { action: "leave", reason: `screen route was ${screenRoute ?? "unrecorded"}, not advance` };
  }
  if (gate === "offer") {
    if (typeof scorecardRecommendation === "string" && POSITIVE_RECOMMENDATIONS.includes(scorecardRecommendation)) {
      return { action: "approve", reason: `scorecard recommendation: ${scorecardRecommendation}` };
    }
    if (scorecardRecommendation === "unrated") return { action: "decline", reason: "scorecard unrated: no interview session" };
    if (scorecardRecommendation === null || scorecardRecommendation === undefined) return { action: "decline", reason: "no scorecard card recorded" };
    return { action: "decline", reason: `scorecard recommendation: ${scorecardRecommendation}` };
  }
  return { action: "leave", reason: `unknown gate ${gate}` };
}

function latestOf(artifacts, kind, branchRef) {
  return artifacts.filter((a) => a.kind === kind && a.branchRef === branchRef).sort((a, b) => b.seq - a.seq)[0];
}

/** How the screen routed one branch, read off the ledger. The latest screen row of the chain
 *  carries the decisions (the gate commit copies the parked payload), so it is the same
 *  answer at the gate and after it. A proposed rejection outranks a hold, which outranks an
 *  advance — the same `.some(reject_proposed)` the engine's own commit reads.
 *  @param {{ kind: string, branchRef: string|null, seq: number, payload?: any }[]} artifacts
 *  @returns {string|null} */
export function screenRouteOf(artifacts, branchRef) {
  const screen = latestOf(artifacts, "screen", branchRef);
  const routes = (Array.isArray(screen?.payload?.decisions) ? screen.payload.decisions : []).map((d) => d?.route);
  for (const route of ["reject_proposed", "hold", "advance"]) if (routes.includes(route)) return route;
  return null;
}

/** The recommendation on the branch's latest COMPLETE scorecard card, or null when no such
 *  card exists. A card for another entry is not this branch's card.
 *  @param {{ kind: string, branchRef: string|null, status: string, seq: number, payload?: any }[]} artifacts
 *  @returns {string|null} */
export function scorecardRecommendationOf(artifacts, branchRef) {
  const scorecard = latestOf(artifacts.filter((a) => a.status === "complete"), "scorecard", branchRef);
  const cards = Array.isArray(scorecard?.payload?.cards) ? scorecard.payload.cards : [];
  const card = cards.find((c) => c?.entryId === branchRef);
  return typeof card?.recommendation === "string" ? card.recommendation : null;
}

const GATES = Object.values(GATE_OF_STAGE);
const ACTION_COLUMN = { approve: "approved", decline: "declined", leave: "left" };

/** What the stand-in did, per gate and per reason.
 *  @param {{ gate: string, action: "approve"|"decline"|"leave", reason: string }[]} decisions
 *  @returns {{
 *    byGate: Record<string, { approved: number, declined: number, left: number }>,
 *    reasons: { action: "decline"|"leave", gate: string, reason: string, count: number }[],
 *  }} */
export function tallyStandIn(decisions) {
  const byGate = Object.fromEntries(GATES.map((g) => [g, { approved: 0, declined: 0, left: 0 }]));
  const reasons = new Map();
  for (const d of decisions) {
    if (!byGate[d.gate] || !ACTION_COLUMN[d.action]) continue;
    byGate[d.gate][ACTION_COLUMN[d.action]] += 1;
    if (d.action === "approve") continue;
    const key = `${d.action}|${d.gate}|${d.reason}`;
    const row = reasons.get(key) ?? { action: d.action, gate: d.gate, reason: d.reason, count: 0 };
    row.count += 1;
    reasons.set(key, row);
  }
  const order = (r) => GATES.indexOf(r.gate) * 2 + (r.action === "decline" ? 0 : 1);
  return { byGate, reasons: [...reasons.values()].sort((a, b) => order(a) - order(b) || b.count - a.count || a.reason.localeCompare(b.reason)) };
}

const count = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const GATE_NAME = { rejection: "rejection", interview_invite: "interview-invite", offer: "offer" };

/** What stopped a policy run, as clauses: the offers approved, what was declined and why, and
 *  who was held for a person where.
 *  @param {ReturnType<typeof tallyStandIn>} tally */
function stoppedClauses(tally) {
  const clauses = [`${count(tally.byGate.offer.approved, "offer")} approved`];
  for (const r of tally.reasons.filter((x) => x.action === "decline")) {
    clauses.push(r.gate === "offer" ? `${count(r.count, "offer")} declined (${r.reason})` : `${r.count} declined at the ${GATE_NAME[r.gate]} gate (${r.reason})`);
  }
  for (const gate of GATES) {
    const held = tally.byGate[gate].left;
    if (held > 0) clauses.push(`${held} held for a person at the ${GATE_NAME[gate]} gate`);
  }
  return clauses;
}

/** The goal-1 headline, from roleRunGoalOneSteps (app/_lib/role-run-metrics.ts), the reading
 *  above and what the stand-in did. A run that could not be read at all keeps its own "not
 *  measured: <reason>" — the cause, not the ledger's emptiness; otherwise the verdict leads.
 *  Operator's decision of 2026-10-06 (ADR-0011 amendment): the three approval gates are
 *  allowed steps, so a run that stops at one is "not met", with what stopped it named.
 *
 *  `standIn` is null for a run nobody passed gates on, else `{ mode, tally }`:
 *   - `policy` (--approve-gates): "met" only when the ledger says met AND the stand-in
 *     approved an offer — every approval it gives carries a recorded basis by construction —
 *     and the verdict says the gates were signed by the stand-in, not a person. Anything else
 *     names what stopped the run: offers approved, offers declined and why, branches held.
 *   - `all` (--approve-all): mechanics only. The verdict is WITHHELD, never "met", because
 *     the stand-in approved without a policy: an approval with no basis proves nothing.
 *
 *  @param {{ verdict: string, reason: string|null, humanStepsOutsideGates?: number }} goalOne
 *  @param {{ measured: boolean, headline: string }} reading
 *  `standIn.simulatedOffers` (optional) is how many of the approved offers rest on a scorecard
 *  from a simulated interview (simulatedOfferCount); above 0 the headline carries the label.
 *  @param {{ mode: "policy"|"all", tally: ReturnType<typeof tallyStandIn>, simulatedOffers?: number } | null} [standIn] */
export function goalOneHeadline(goalOne, reading, standIn = null) {
  if (!reading.measured) return reading.headline;
  if (standIn?.mode === "all") return "goal 1: verdict withheld: the stand-in approved without a policy (--approve-all, mechanics only)";
  if (goalOne.verdict === "not measured") return `not measured: ${goalOne.reason}`;
  if (!standIn) return goalOne.verdict === "met" ? "goal 1: met" : `goal 1: not met: ${goalOne.reason}`;
  const tag = " (gates approved by demo stand-in)";
  const offers = standIn.tally.byGate.offer.approved;
  if (goalOne.verdict === "met" && offers > 0) {
    // An approval that rests on a scorecard from a SIMULATED interview is never a plain "met":
    // the candidate was played by the model, and the headline says so (ADR-0011, 2026-10-06).
    const simulated = standIn.simulatedOffers ?? 0;
    if (simulated > 0) {
      const share = simulated < offers ? `, ${simulated} of ${offers} approved offers on a simulated interview` : "";
      return `goal 1: met on a SIMULATED interview (candidate played by the model from the CV on the entry), gates by the demo stand-in: ${count(offers, "offer")} approved on a recorded basis${share}`;
    }
    return `goal 1: met: ${count(offers, "offer")} approved on a recorded basis${tag}`;
  }
  const clauses = stoppedClauses(standIn.tally);
  // A human act outside the gates, or a stop the stand-in did not cause, is the ledger's to name.
  if ((goalOne.humanStepsOutsideGates ?? 0) > 0 || clauses.length === 1) clauses.push(goalOne.reason ?? "no offer approved");
  return `goal 1: not met: ${clauses.join("; ")}${tag}`;
}

/** The stand-in's tally as lines: one per gate with approved / declined / left, then every
 *  decline and leave reason with its count.
 *  @param {ReturnType<typeof tallyStandIn>} tally
 *  @returns {string[]} */
export function formatStandInTally(tally) {
  const lines = GATES.map((g) => `${g}: approved ${tally.byGate[g].approved} · declined ${tally.byGate[g].declined} · left ${tally.byGate[g].left}`);
  for (const r of tally.reasons) lines.push(`${r.action === "decline" ? "declined" : "left"} at ${r.gate} ×${r.count}: ${r.reason}`);
  return lines;
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

/** Where each branch got to: its furthest ladder stage, per branch, in order of appearance.
 *  The run-wide chain (branchRef null) is not a branch.
 *  @param {{ kind: string, branchRef: string|null, seq: number }[]} artifacts
 *  @returns {{ branchRef: string, furthest: string }[]} */
export function furthestPerBranch(artifacts) {
  const best = new Map();
  for (const a of [...artifacts].sort((x, y) => x.seq - y.seq)) {
    if (a.branchRef === null || !STAGE_ORDER.includes(a.kind)) continue;
    if (!best.has(a.branchRef) || STAGE_ORDER.indexOf(a.kind) > STAGE_ORDER.indexOf(best.get(a.branchRef))) best.set(a.branchRef, a.kind);
  }
  return [...best].map(([branchRef, furthest]) => ({ branchRef, furthest }));
}

/** How many branches got furthest to each stage, in ladder order.
 *  @param {{ kind: string, branchRef: string|null, seq: number }[]} artifacts
 *  @returns {{ kind: string, branches: number }[]} */
export function branchesByFurthest(artifacts) {
  const per = furthestPerBranch(artifacts);
  return STAGE_ORDER.map((kind) => ({ kind, branches: per.filter((p) => p.furthest === kind).length })).filter((r) => r.branches > 0);
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

/** A simulated-interview row is RATED only when it carries a recommendation: a session with
 *  no accepted scorecard (the template case) is not a basis for anything. */
export function isRatedSimulatedRow(row) {
  return Boolean(row) && row.skipped === null && typeof row.sessionId === "string" && typeof row.recommendation === "string";
}

/** How many approved offers rest on a scorecard from a simulated interview: the offer
 *  approvals the stand-in gave, on branches whose simulated interview was rated.
 *  @param {{ gate: string, branchRef: string, action: string }[]} decisions
 *  @param {{ branchRef: string, sessionId: string|null, recommendation: string|null, skipped: string|null }[]} rows
 *  @returns {number} */
export function simulatedOfferCount(decisions, rows) {
  const rated = new Set(rows.filter(isRatedSimulatedRow).map((r) => r.branchRef));
  return decisions.filter((d) => d.gate === "offer" && d.action === "approve" && rated.has(d.branchRef)).length;
}

/** WHERE THE CVs GO, in one line, in the run's own output — printed and in the `--json`
 *  reading. The demo sends the played entry's CV profile and the entry's private interviewer
 *  brief to a `claude -p` child on this machine's Claude seat (interview-sim/providers.ts);
 *  no other provider, no API key, no service in between. Part of closing finding 2b
 *  (docs/security/role-demo-sim-scan-2026-10-06.md) alongside the seeded-only rule. */
export const SIM_PROVIDER_LINE =
  "the CV of every played (seeded) entry goes to the Claude CLI (`claude -p`) on this machine's Claude seat — no other provider, no API key, no service in between";

/** The prefix a not-seed refusal's reason carries. Restated from role-demo.ts NOT_SEED_DATA
 *  (this file loads no TS); role-demo-interviews.test.mjs pins the two to agree. */
export const NOT_SEED_REFUSAL = "not simulated: not seed data";

/** How many branches were refused because they could not be proven seed data — the count the
 *  reading owes the operator once the demo plays only what it can prove (finding 2b).
 *  @param {{ skipped: string|null }[]} rows
 *  @returns {number} */
export function notSeedRefusalCount(rows) {
  return (rows ?? []).filter((r) => typeof r?.skipped === "string" && r.skipped.startsWith(NOT_SEED_REFUSAL)).length;
}

/** The simulated interviews as lines: one per branch with counts and the recommendation —
 *  never a transcript or scorecard text.
 *  @param {{ branchRef: string, sessionId: string|null, recommendation: string|null, verdictSource: string|null, turns: number, endReason: string|null, skipped: string|null }[]} rows
 *  @returns {string[]} */
export function formatSimulatedInterviews(rows) {
  return rows.map((r) => {
    if (isRatedSimulatedRow(r)) return `${r.branchRef}: session ${r.sessionId} · ${r.recommendation} (${r.verdictSource ?? "unknown"}) · ${r.turns} turns · ended ${r.endReason ?? "unknown"}`;
    const counts = r.sessionId ? ` · session ${r.sessionId} · ${r.turns} turns · ended ${r.endReason ?? "unknown"}` : "";
    return `${r.branchRef}: ${r.skipped ?? "not rated"}${counts}`;
  });
}
