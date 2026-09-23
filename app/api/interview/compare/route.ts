import { NextRequest, NextResponse } from "next/server";
import { isEarlyCareer } from "@/app/_lib/archetypes";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { interviewedForJob, latestInterviewByEntry } from "@/app/_lib/db/interviews";
import { listEntriesForJob } from "@/app/_lib/db/pipeline";
import { getHumanScorecard } from "@/app/_lib/interview-prep";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { INTERVIEW_RUBRICS, RATING_ANCHORS } from "@/app/_lib/interview-rubric";
import type { InterviewTelemetry } from "@/app/_lib/interview-telemetry";
import { listInterviewEvents } from "@/app/_lib/db/interview-events";
import { axisCoverage, type AxisCoverage } from "@/app/_lib/interview-axis-coverage";
import type { InterviewAgenda } from "@/app/_lib/voice/director-types";

// The engine attaches deterministic call telemetry (talk ratio, response gaps,
// hint uptake) to the AI scorecard object, but interviewedForJob projects only
// the rubric fields the grid needs and drops it. Re-read the candidate's latest
// (transcript-bearing) session and pull the telemetry so the compare grid can
// show conversational-dynamics signals per candidate. Best-effort + null-safe:
// an entry-less lab session or an older scorecard simply yields null (no signal),
// never an error — telemetry is descriptive enrichment, never a gate.
function telemetryForEntry(entryId: string | null, workspaceId: string): InterviewTelemetry | null {
  if (!entryId) return null;
  const sc = latestInterviewByEntry(entryId, workspaceId)?.scorecard as { telemetry?: InterviewTelemetry } | null;
  return sc?.telemetry ?? null;
}

// What the interview DIRECTOR recorded per rubric axis for one session: covered on a
// verified quote, only asked, never reached, or never planned, plus the kit must-asks
// the call ended owing (challenge-r07 voice-interview-api/B). The model's own
// "Not assessed" sentinel was the grid's only signal; this is the server's record.
// Counts and states only — no quote, question or block title reaches this payload.
// Best-effort like telemetry: an undirected session (no agenda) or a read failure is
// null, never an error.
const COVERAGE_EVENT_KINDS = ["topic_begun", "topic_covered", "end_requested", "must_ask_unasked"] as const;
function coverageForSession(
  sessionId: string,
  agenda: InterviewAgenda | null,
  scoringModel: string,
  workspaceId: string
): AxisCoverage | null {
  if (!agenda) return null;
  try {
    const events = listInterviewEvents(sessionId, workspaceId, { kinds: COVERAGE_EVENT_KINDS });
    const rubricAxes = (INTERVIEW_RUBRICS[scoringModel] ?? INTERVIEW_RUBRICS.experienced ?? []).map((c) => c.competency);
    return axisCoverage({ agenda, events, rubricAxes });
  } catch (error) {
    console.warn("[api:interview:compare] coverage read failed; the cell renders without it", error);
    return null;
  }
}

// Side-by-side interview comparison for one job. Returns the rubrics keyed by
// scoringModel + each interviewed candidate's scorecard (which carries its own
// scoringModel), so the grid compares candidates on the axes for THEIR cohort —
// a student's 6 potential constructs and an experienced hire's 5 axes line up
// within their own cohort rather than being forced onto one rubric.
export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("job");
  if (!jobId) return jsonRefusal("INTERVIEW_JOB_REQUIRED", 400);
  try {
    // Tenancy — BOTH cohort reads below are scoped to the caller's own team. The
    // seeded jobs corpus is SHARED (workspace_id NULL), so two teams legitimately
    // run their own candidates under the SAME job id; unscoped, the grid resolved
    // against the default team and rendered ITS candidate names, AI scorecards and
    // human verdicts — the most sensitive screen in the product — to anyone else
    // opening compare on a corpus role. A gated recruiter route, so the session is
    // the authority; and pipeline_entries / interview_sessions always carry a real
    // workspace_id (never the corpus NULL), so strict equality is right here.
    const workspace = await currentWorkspace();
    // Attach each candidate's human scorecard (PREP1), if a recruiter filled one
    // from the prep rubric — so the compare grid shows the human verdict + ratings
    // alongside the AI screen, not just the voice-synthesized one. Null for the
    // common case of no human round.
    // The session id and stored agenda are the coverage read's INPUTS and stop here:
    // the agenda carries question text and block titles, and the grid has no use for
    // a session id.
    const voice = interviewedForJob(jobId, workspace).map(({ sessionId, agenda, ...c }) => ({
      ...c,
      humanScorecard: c.entryId ? getHumanScorecard(c.entryId) : null,
      telemetry: telemetryForEntry(c.entryId, workspace),
      coverage: coverageForSession(sessionId, agenda, c.scoringModel, workspace),
    }));

    // PREP1 (the W10/W14 deferral) — union in candidates whose round was
    // HUMAN-led: a filled human scorecard but no completed voice session. The
    // cohort list used to come only from interview_sessions, so the strongest
    // human signal silently dropped out at the exact surface where the hire
    // decision is weighed — a recruiter concluded the candidate "wasn't
    // interviewed". AI fields stay null/empty (nothing was synthesized);
    // scoringModel derives from the entry archetype, the same split
    // rubricForArchetype scored them on.
    const voiceEntryIds = new Set(voice.map((c) => c.entryId).filter(Boolean));
    const humanOnly = listEntriesForJob(jobId, workspace)
      .filter((e) => !voiceEntryIds.has(e.id))
      .map((e) => ({ entry: e, sc: getHumanScorecard(e.id) }))
      .filter((pair) => pair.sc != null)
      .map(({ entry, sc }) => ({
        entryId: entry.id,
        candidateLabel: entry.candidateLabel,
        recommendation: null,
        summary: null,
        scoringModel: isEarlyCareer(entry.archetype) ? "early_career" : "experienced",
        confidence: null,
        ratings: [],
        observedSkills: [],
        humanScorecard: sc,
        humanOnly: true,
        // A human-led round has no voice session, so no call telemetry — keep the
        // field present (null) so both branches share one candidate shape.
        telemetry: null as InterviewTelemetry | null,
        // No director ran, so no record of what was reached.
        coverage: null as AxisCoverage | null,
      }));

    return NextResponse.json({
      rubrics: INTERVIEW_RUBRICS,
      anchors: RATING_ANCHORS,
      candidates: [...voice, ...humanOnly],
    });
  } catch (error) {
    // Previously uncaught — a thrown SQLite error fell through to the framework
    // handler, which in dev forwards internal detail (idea-ab117371).
    return safeJsonError(error, "api:interview:compare", "INTERVIEW_LOOKUP_FAILED");
  }
}
