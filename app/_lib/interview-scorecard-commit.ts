import { ensureDb } from "./db/core";
import { getEntryWorkspace, getPipelineEntry, recordAutomationEvent, setApproval } from "./db/pipeline";
import { attachInterviewScorecard, type InterviewSession, type VoiceTurn } from "./db/interviews";
import { sealDecisionSafe } from "./decision-record-store";
import { sealableRubricDimensions } from "./interview-scorecard";
import { DEFAULT_STAGE_AXIS, stageHasRole, type StageDef } from "./pipeline-stages";
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

/**
 * Predicate governing the scorecard gate: active, interview role, approval null|calendar.
 * Matches the human scorecard door rule in app/api/interview-prep/scorecard/route.ts.
 */
export function scorecardGateOpen(
  entry: { status: string; stage: string; approvalKind?: string | null },
  stages: readonly StageDef[] = DEFAULT_STAGE_AXIS
): boolean {
  if (entry.status !== "active") return false;
  if (!stageHasRole(entry.stage, "interview", stages)) return false;
  return entry.approvalKind === null || entry.approvalKind === undefined || entry.approvalKind === "calendar";
}

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
): Promise<{ attached: boolean; gate: "opened" | "held" | "closed"; session: InterviewSession | null }> {
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
    const scNotes = buildScorecardNotes(transcript);
    const { notes } = scNotes;
    if (!notes) {
      return { attached: false, gate: "closed", session: null };
    }
    const autoRes = await runAutomationTask(entryId, "scorecard", notes, undefined, undefined, ws, { deferApply: true });
    if (!autoRes.result) {
      return { attached: false, gate: "closed", session: null };
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

    scored = { scorecard, provenance, actor, recommendation, version };
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
