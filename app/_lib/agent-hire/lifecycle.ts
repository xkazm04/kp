import { AGENT_TRANSITIONS, canTransition, type AgentStatus, type HiredAgentRecord } from "../db/agents";
import { createPipelineEntry, recordAutomationEvent, setPipelineEntryStage } from "../db/pipeline";
import { stageForRole } from "../pipeline-axis-server";
import type { AgentLifecycleEvent, ProbationDecision } from "./report-payload";

// The hired-agent transition door. The push report, the pull refresh and the
// dispatch each kept a private Personas→AgentStatus mapping and board move, and
// the copies drifted. Now: the table (owned by db/agents.ts so the store can
// refuse an illegal move without importing this module), lifecycleTarget() for
// BOTH vocabularies, and placeAgentOnBoard() — the one role-resolved board move.

export { AGENT_TRANSITIONS, canTransition };

export type LifecycleSignal =
  | { kind: "push"; event: AgentLifecycleEvent; decision?: ProbationDecision | null }
  | { kind: "poll"; status: string };

const PUSH_TARGET: Record<Exclude<AgentLifecycleEvent, "probation_review">, AgentStatus> = {
  approved: "onboarding",
  onboarding: "onboarding",
  activated: "active",
  rejected: "rejected",
  retired: "retired",
};

// The probation review's DECISION is the transition; `extended` stays in
// onboarding — more probation is not a promotion.
const PROBATION_TARGET: Record<ProbationDecision, AgentStatus> = {
  activated: "active",
  extended: "onboarding",
  retired: "retired",
};

// expired = the approval sat past the 24h consent window; failed = the executor
// could not create the persona. Both terminal, both free the job for re-dispatch.
const POLL_TARGET: Record<string, AgentStatus> = {
  pending: "pending_approval",
  pending_approval: "pending_approval",
  approved: "onboarding",
  onboarding: "onboarding",
  building: "onboarding",
  active: "active",
  activated: "active",
  rejected: "rejected",
  retired: "retired",
  expired: "failed",
  failed: "failed",
};

/** The status a Personas signal asks for; null = a word kp does not know (no write). */
export function lifecycleTarget(signal: LifecycleSignal): AgentStatus | null {
  if (signal.kind === "poll") {
    const key = signal.status.toLowerCase();
    return Object.prototype.hasOwnProperty.call(POLL_TARGET, key) ? POLL_TARGET[key]! : null;
  }
  if (signal.event === "probation_review") return signal.decision ? PROBATION_TARGET[signal.decision] : null;
  return PUSH_TARGET[signal.event];
}

/** The ledger event name a signal is recorded under. */
export function lifecycleEventName(signal: LifecycleSignal): string {
  if (signal.kind === "poll") return `poll:${signal.status}`;
  return signal.event === "probation_review" ? `probation_review:${signal.decision ?? "none"}` : signal.event;
}

// Personas (or a poll) moved this card, not a recruiter.
export const AGENT_BRIDGE_ACTOR = "auto:agent-bridge";

export type BoardPlacement = { entryId: string; stage: string; moved: boolean };

/**
 * The ONE board move for a hired agent, stages resolved BY ROLE off the
 * workspace axis (a renamed board has no "Offer"/"Hired"). `offer` files the
 * dispatch card (offer role, else entry) marked `agent_dispatched`; `hired`
 * moves the same idempotent entry to the terminal role under an expectedStage
 * CAS and marks `agent_activated` — on the push AND the poll path. Null for an
 * App-master hire from an intake: no job posting, no board.
 */
export function placeAgentOnBoard(
  agent: HiredAgentRecord,
  move: "offer" | "hired",
  workspaceId: string,
  opts: { label?: string | null; personaId?: string | null; requestId?: string | null } = {}
): BoardPlacement | null {
  if (!agent.jobId) return null;
  const offerStage = stageForRole("offer", workspaceId) ?? stageForRole("entry", workspaceId);
  const { entry } = createPipelineEntry({
    candidateId: `agent-${agent.id}`,
    candidateLabel: opts.label || agent.personaName || agent.jobTitle,
    jobId: agent.jobId,
    jobTitle: agent.jobTitle,
    ...(offerStage ? { stage: offerStage } : {}),
    sourceChannel: "agent-bridge",
    workspaceId,
  });
  if (move === "offer") {
    const req = opts.requestId ?? agent.requestId ?? "";
    recordAutomationEvent(entry.id, "agent_dispatched", `Persona request ${req} awaiting approval in Personas`, workspaceId);
    return { entryId: entry.id, stage: entry.stage, moved: false };
  }
  const terminal = stageForRole("terminal", workspaceId);
  const moved =
    terminal && terminal !== entry.stage
      ? setPipelineEntryStage(entry.id, terminal, { expectedStage: entry.stage, actorRef: AGENT_BRIDGE_ACTOR }, workspaceId)
      : terminal
        ? entry
        : null;
  const persona = opts.personaId ?? agent.personaId ?? "";
  recordAutomationEvent(
    entry.id,
    "agent_activated",
    moved
      ? `Personas persona ${persona} went live`
      : `Personas persona ${persona} went live; board move skipped (the entry moved first or this board has no terminal column)`,
    workspaceId,
    AGENT_BRIDGE_ACTOR
  );
  return { entryId: entry.id, stage: moved?.stage ?? entry.stage, moved: moved !== null && moved !== entry };
}
