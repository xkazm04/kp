// The Grand Simulation's RUN ID and machine-readable STEP LEDGER.
//
// The goal this walk is measured by is "a full demo run on the seeded corpus with
// zero manual edits between steps, recorded as a KPI with the date and the run id".
// Until this module there was no run id and the walk's only output was a human log
// line per step, so the measurement could not be taken at all. The walk already
// BRANCHES on the fact that matters (the interview chapter's manual Confirm fallback,
// a move that fell back from the DOM click to the checked API call) and threw it away.
// The ledger keeps it: one record per chapter with an `actor`, so "zero manual edits"
// is a count rather than a claim.
//
// Pure: no React, no fetch. useSimulationWalk owns the awaits and calls begin/note/end.

/** Who did the chapter's work. `auto`: the scripted walk alone. `approval`: the walk
 *  plus a recorded human-approval gate (the screening wave's Art. 22 token).
 *  `manual-fallback`: the scripted path failed and the recruiter-side fallback ran. */
export const SIM_ACTORS = ["auto", "approval", "manual-fallback"] as const;
export type SimActor = (typeof SIM_ACTORS)[number];

export type SimStepOutcome = "passed" | "failed" | "stopped";

export type SimLedgerStep = {
  runId: string;
  phase: string;
  startedAt: string;
  endedAt: string;
  outcome: SimStepOutcome;
  actor: SimActor;
};

/** Higher wins: a chapter that needed a fallback is a fallback chapter even if it
 *  also carried an approval. */
const ACTOR_RANK: Record<SimActor, number> = { auto: 0, approval: 1, "manual-fallback": 2 };

/** A run id: sortable by start time, unique enough for one tenant's demo history. */
export function mintRunId(now: () => number = Date.now, rand: () => number = Math.random): string {
  const stamp = now().toString(36).padStart(9, "0"); // fixed width: lexical order is start order
  const salt = Math.floor(rand() * 36 ** 4).toString(36).padStart(4, "0");
  return `sim-${stamp}-${salt}`;
}

export type SimLedger = {
  readonly runId: string;
  /** Open a chapter. A chapter still open is closed as `failed` first. */
  begin: (phase: string) => void;
  /** Record who did (part of) the open chapter's work; the strongest actor wins. */
  note: (actor: SimActor) => void;
  /** Close the open chapter. No-op when none is open. */
  end: (outcome: SimStepOutcome) => void;
  /** The closed records so far (a copy). */
  steps: () => SimLedgerStep[];
};

export function createLedger(runId: string = mintRunId(), clock: () => Date = () => new Date()): SimLedger {
  const steps: SimLedgerStep[] = [];
  let open: { phase: string; startedAt: string; actor: SimActor } | null = null;
  const end = (outcome: SimStepOutcome) => {
    if (!open) return;
    steps.push({ runId, phase: open.phase, startedAt: open.startedAt, endedAt: clock().toISOString(), outcome, actor: open.actor });
    open = null;
  };
  return {
    runId,
    begin(phase) {
      end("failed");
      open = { phase, startedAt: clock().toISOString(), actor: "auto" };
    },
    note(actor) {
      if (open && ACTOR_RANK[actor] > ACTOR_RANK[open.actor]) open.actor = actor;
    },
    end,
    steps: () => steps.map((s) => ({ ...s })),
  };
}

/** The KPI reading of a ledger: how many chapters passed and how many needed a
 *  manual fallback. `zeroManualEdits` is true only for a fully-passed, non-empty run
 *  with no fallback chapter. */
export function summarizeLedger(steps: readonly SimLedgerStep[]): {
  runId: string | null;
  passed: number;
  manualFallbacks: number;
  approvals: number;
  zeroManualEdits: boolean;
} {
  const passed = steps.filter((s) => s.outcome === "passed").length;
  const manualFallbacks = steps.filter((s) => s.actor === "manual-fallback").length;
  const approvals = steps.filter((s) => s.actor === "approval").length;
  return {
    runId: steps[0]?.runId ?? null,
    passed,
    manualFallbacks,
    approvals,
    zeroManualEdits: steps.length > 0 && passed === steps.length && manualFallbacks === 0,
  };
}
