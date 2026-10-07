import { ensureDb } from "./db/core";
import { getEntryWorkspace, getPipelineEntry, recordAutomationEvent, setApproval } from "./db/pipeline";
import { attachInterviewScorecard, type InterviewSession, type VoiceTurn } from "./db/interviews";
import { sealDecisionSafe } from "./decision-record-store";
import { isPlaceholderEvidence, sealableRubricDimensions } from "./interview-scorecard";
import { stageHasRole, type StageDef } from "./pipeline-stages";
import { scorecardGateOpen } from "./interview-scorecard-gate";
import { getPipelineAxis } from "./pipeline-axis-server";
import {
  AUTOMATION_VERSION,
  automationProviderLabel,
  runAutomationTask,
  verdictSourceOf,
  type VerdictProvenance,
} from "./automation-run";
import { buildScorecardNotes, coverageFromNotes } from "./interview-transcript";
import { extractTelemetry } from "./interview-telemetry";
import { stampAiScorecardRubricCoverage } from "./interview-run";
import { isEarlyCareer } from "./archetypes";
import { devCaseIdForEntry } from "./devcase-identity";
import { getDevCase } from "./db/devcase";
import { STUDENT_SCRIPT, type CaseInterviewScenario } from "./student-interview";

export { scorecardGateOpen };

/**
 * Synchronous and locked write half: attachInterviewScorecard CAS, re-reads entry,
 * sets approval if gate is open, records automation event. All inside one immediate transaction.
 */
export function commitCandidateScorecard(
  session: { id: string; entryId: string; workspaceId?: string },
  scorecard: Record<string, unknown>,
  provenance: VerdictProvenance,
  options?: {
    actor?: string;
    recommendation?: string;
    attach?: (sessionId: string, scorecard: unknown) => { session: InterviewSession | null; applied: boolean };
    stages?: readonly StageDef[];
  }
): { attached: boolean; gate: "opened" | "held" | "closed"; session: InterviewSession | null } {
  const ws = session.workspaceId ?? getEntryWorkspace(session.entryId);
  const stages = options?.stages ?? getPipelineAxis(ws).stages;
  const db = ensureDb();
  const tx = db.transaction(() => {
    const attachFn = options?.attach ?? attachInterviewScorecard;
    const attached = attachFn(session.id, scorecard);
    if (!attached.applied) {
      return { attached: false, gate: "closed" as const, session: attached.session };
    }

    const entry = getPipelineEntry(session.entryId, ws);

    if (!entry) {
      return { attached: true, gate: "closed" as const, session: attached.session };
    }

    if (scorecardGateOpen(entry, stages)) {
      const rec = options?.recommendation ?? (typeof scorecard.recommendation === "string" ? scorecard.recommendation : "hold");
      const actor = options?.actor ?? `auto:automation-${provenance.verdictSource}`;
      const approvalPayload = JSON.stringify({ ...scorecard, ...provenance });
      setApproval(entry.id, "scorecard_review", approvalPayload, ws, {
        expectedApprovalKind: entry.approvalKind,
      });
      recordAutomationEvent(entry.id, "interview_scorecard", rec, ws, actor);
      return { attached: true, gate: "opened" as const, session: attached.session };
    }

    if (
      entry.status === "active" &&
      stageHasRole(entry.stage, "interview", stages) &&
      entry.approvalKind === "scorecard_review"
    ) {
      return { attached: true, gate: "held" as const, session: attached.session };
    }

    return { attached: true, gate: "closed" as const, session: attached.session };
  });

  return tx.immediate();
}

/** The code a refused (reasons-less) scorecard answers with. */
export const SCORECARD_UNGROUNDED = "INTERVIEW_SCORECARD_UNGROUNDED" as const;

/**
 * True when a scorecard carries no reasons: no ratings, or every rating's evidence is
 * empty or a "Not assessed…" placeholder (the keyless / model-down / all-ungrounded
 * output of the scorer). Such a verdict must not be attached, approved, sealed or minted.
 */
export function scorecardHasNoReasons(scorecard: Record<string, unknown>): boolean {
  const ratings = scorecard.ratings;
  if (!Array.isArray(ratings) || ratings.length === 0) return true;
  return ratings.every((r) => {
    const evidence = r && typeof r === "object" ? (r as { evidence?: unknown }).evidence : undefined;
    return isPlaceholderEvidence(typeof evidence === "string" ? evidence : null);
  });
}

export type FinalizeResult = {
  attached: boolean;
  gate: "opened" | "held" | "closed";
  session: InterviewSession | null;
  /** Set when the scorecard was refused before any write. */
  refusal?: typeof SCORECARD_UNGROUNDED;
};

export type FinalizeScoringDeps = {
  score?: (session: InterviewSession, transcript: VoiceTurn[]) => Promise<{
    scorecard: Record<string, unknown>;
    provenance: VerdictProvenance;
    actor?: string;
    recommendation?: string;
    version?: string;
  }>;
  mint?: (entryId: string, scorecard: Record<string, unknown>) => Promise<{ credited: string[] }>;
  attach?: (sessionId: string, scorecard: unknown) => { session: InterviewSession | null; applied: boolean };
  seal?: typeof sealDecisionSafe;
};

/**
 * Orchestrator called by POST /api/interview/complete and rescore:
 * score (outside tx) -> commitCandidateScorecard (immediate tx) -> seal -> mint -> re-attach.
 */
export async function finalizeCandidateInterviewScoring(
  session: InterviewSession,
  transcript: VoiceTurn[],
  deps?: FinalizeScoringDeps
): Promise<FinalizeResult> {
  if (!session.entryId) {
    return { attached: false, gate: "closed", session: null };
  }
  const entryId = session.entryId;
  const sessionWithEntry = { ...session, entryId };
  const ws = session.workspaceId ?? getEntryWorkspace(entryId);
  let scored: {
    scorecard: Record<string, unknown>;
    provenance: VerdictProvenance;
    actor?: string;
    recommendation?: string;
    version?: string;
  };

  if (deps?.score) {
    scored = await deps.score(session, transcript);
  } else {
    const synthesized = await synthesizeCandidateScorecard(session, transcript);
    if (!synthesized) return { attached: false, gate: "closed", session: null };
    scored = synthesized;
  }

  if (scorecardHasNoReasons(scored.scorecard)) {
    return { attached: false, gate: "closed", session: null, refusal: SCORECARD_UNGROUNDED };
  }

  const committed = commitCandidateScorecard(sessionWithEntry, scored.scorecard, scored.provenance, {
    actor: scored.actor,
    recommendation: scored.recommendation,
    attach: deps?.attach,
  });

  if (committed.attached) {
    const seal = deps?.seal ?? sealDecisionSafe;
    const rec = typeof scored.scorecard.recommendation === "string" ? scored.scorecard.recommendation : (scored.recommendation ?? "hold");
    seal({
      kind: "ai_scorecard",
      actor: scored.actor ?? `auto:${scored.version ?? AUTOMATION_VERSION.scorecard}`,
      policyVersion: scored.version ?? AUTOMATION_VERSION.scorecard,
      candidateRef: entryId,
      rationale: `AI interview scorecard — recommendation: ${rec}.`,
      reasonCode: "scorecard",
      inputs: {
        recommendation: rec,
        dimensions: sealableRubricDimensions((scored.scorecard as { ratings?: unknown[] }).ratings),
      },
    });

    let creditedSkills: string[] | undefined;
    if (deps?.mint) {
      const minted = await deps.mint(entryId, scored.scorecard);
      creditedSkills = minted.credited;
    } else {
      try {
        const { mintObservedFromCaseInterview } = await import("./devcase-run");
        const minted = await mintObservedFromCaseInterview(entryId, scored.scorecard, ws);
        creditedSkills = minted.credited;
      } catch {
        /* minting is enrichment */
      }
    }

    if (creditedSkills && creditedSkills.length > 0) {
      scored.scorecard.observedSkills = creditedSkills;
      const reattach = deps?.attach ?? attachInterviewScorecard;
      const reattached = reattach(session.id, scored.scorecard);
      if (reattached.session) {
        committed.session = reattached.session;
      }
      if (committed.gate === "opened") {
        const fresh = getPipelineEntry(entryId, ws);
        if (fresh && fresh.approvalKind === "scorecard_review") {
          const detail = JSON.parse(fresh.approvalDetail ?? "{}");
          detail.observedSkills = creditedSkills;
          setApproval(entryId, "scorecard_review", JSON.stringify(detail), ws);
        }
      }
    }
  }

  return {
    attached: committed.attached,
    gate: committed.gate,
    session: committed.session,
  };
}

/** What the scoring half of a completed interview produces, before anything is written. */
export type SynthesizedScorecard = {
  scorecard: Record<string, unknown>;
  provenance: VerdictProvenance;
  actor?: string;
  recommendation?: string;
  version?: string;
};

/**
 * The default scorer: the transcript into the `scorecard` automation task (outside any
 * transaction), plus the telemetry/coverage enrichment. Null when there is nothing to
 * score — an empty transcript, or a task that answered no result. Exported so a caller
 * that must refuse a template-sourced verdict (the goal-1 demo run) can wrap the SAME
 * scorer through `FinalizeScoringDeps.score` instead of copying it.
 */
export async function synthesizeCandidateScorecard(
  session: InterviewSession,
  transcript: VoiceTurn[]
): Promise<SynthesizedScorecard | null> {
  const entryId = session.entryId;
  if (!entryId) return null;
  const ws = session.workspaceId ?? getEntryWorkspace(entryId);
  const scNotes = buildScorecardNotes(transcript);
  const { notes } = scNotes;
  if (!notes) {
    return null;
  }
  const autoRes = await runAutomationTask(entryId, "scorecard", notes, undefined, undefined, ws, { deferApply: true });
  if (!autoRes.result) {
    return null;
  }
  const scorecard = autoRes.result as Record<string, unknown>;
  const provenance = autoRes.deferred?.provenance ?? {
    verdictSource: verdictSourceOf(autoRes.source),
    verdictProvider: autoRes.source === "llm" ? automationProviderLabel() : null,
  };
  const actor = autoRes.deferred?.actor ?? `auto:automation-${provenance.verdictSource}`;
  const recommendation = autoRes.deferred?.recommendation ?? "hold";
  const version = AUTOMATION_VERSION.scorecard;

  try {
    const entry = getPipelineEntry(entryId, ws);
    stampAiScorecardRubricCoverage(scorecard, entry?.roleFamily);
    let hintText: string | null = null;
    if (entry && isEarlyCareer(entry.archetype)) {
      const caseId = devCaseIdForEntry(entry);
      const scenario = caseId ? ((getDevCase(caseId)?.scenario as CaseInterviewScenario | null) ?? null) : null;
      const phases = scenario?.phases?.length ? scenario.phases : STUDENT_SCRIPT;
      hintText = phases.find((p) => p.caseGrounded && (p.feeds ?? []).includes("Coachability"))?.probe ?? null;
    }
    scorecard.telemetry = extractTelemetry(transcript, { hintText });
  } catch {
    /* telemetry is enrichment */
  }
  const coverage = coverageFromNotes(scNotes);
  if (coverage) scorecard.coverage = coverage;

  return { scorecard, provenance, actor, recommendation, version };
}
