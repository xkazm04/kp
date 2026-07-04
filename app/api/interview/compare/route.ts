import { NextRequest, NextResponse } from "next/server";
import { isEarlyCareer } from "@/app/_lib/archetypes";
import { interviewedForJob, listEntriesForJob } from "@/app/_lib/db";
import { getHumanScorecard } from "@/app/_lib/interview-prep";
import { safeJsonError } from "@/app/_lib/api-response";
import { INTERVIEW_RUBRICS, RATING_ANCHORS } from "@/app/_lib/interview-rubric";


// Side-by-side interview comparison for one job. Returns the rubrics keyed by
// scoringModel + each interviewed candidate's scorecard (which carries its own
// scoringModel), so the grid compares candidates on the axes for THEIR cohort —
// a student's 6 potential constructs and an experienced hire's 5 axes line up
// within their own cohort rather than being forced onto one rubric.
export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("job");
  if (!jobId) return NextResponse.json({ error: "job is required" }, { status: 400 });
  try {
    // Attach each candidate's human scorecard (PREP1), if a recruiter filled one
    // from the prep rubric — so the compare grid shows the human verdict + ratings
    // alongside the AI screen, not just the voice-synthesized one. Null for the
    // common case of no human round.
    const voice = interviewedForJob(jobId).map((c) => ({
      ...c,
      humanScorecard: c.entryId ? getHumanScorecard(c.entryId) : null,
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
    const humanOnly = listEntriesForJob(jobId)
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
