import { NextRequest, NextResponse } from "next/server";
import { getPipelineEntry, recordAutomationEvent, setApproval } from "@/app/_lib/db";
import { saveHumanScorecard } from "@/app/_lib/interview-prep";
import { coerceInterviewRecommendation, isInterviewRecommendation } from "@/app/_lib/interview-recommendation";
import { RATING_MAX } from "@/app/_lib/format";
import { safeJsonError } from "@/app/_lib/api-response";
import type { Scorecard, ScorecardRating } from "@/app/_lib/interview-scorecard";

export const runtime = "nodejs";

// Caps for the human scorecard write (PREP1). The rubric has a handful of
// competencies; evidence/summary are short notes, not documents.
const MAX_RATINGS = 30;
const MAX_COMPETENCY = 200;
const MAX_EVIDENCE = 2_000;
const MAX_SUMMARY = 4_000;

// POST ?entry=<id> → save the recruiter's human-filled scorecard onto the entry's
// prep artifact. Validated field-by-field at the trust boundary (not cast): each
// rating's competency is a bounded string, the rating clamps to [1, RATING_MAX],
// evidence/summary are length-capped, and the recommendation is coerced onto the
// canonical advance|hold|reject set. 404 when no prep artifact exists yet.
export async function POST(request: NextRequest) {
  try {
    const entry = request.nextUrl.searchParams.get("entry");
    if (!entry || !entry.trim() || entry.length > 120) {
      return NextResponse.json({ error: "entry is required" }, { status: 400 });
    }
    const body = (await request.json().catch(() => ({}))) as {
      ratings?: unknown;
      summary?: unknown;
      recommendation?: unknown;
    };

    const ratings: ScorecardRating[] = [];
    if (Array.isArray(body.ratings)) {
      for (const raw of body.ratings) {
        if (ratings.length >= MAX_RATINGS) break;
        if (!raw || typeof raw !== "object") continue;
        const r = raw as Record<string, unknown>;
        const competency = typeof r.competency === "string" ? r.competency.slice(0, MAX_COMPETENCY).trim() : "";
        if (!competency) continue;
        const n = typeof r.rating === "number" ? r.rating : Number(r.rating);
        if (!Number.isFinite(n)) continue; // an unrated competency is simply omitted
        const rating = Math.min(RATING_MAX, Math.max(1, Math.round(n)));
        const evidence = typeof r.evidence === "string" ? r.evidence.slice(0, MAX_EVIDENCE).trim() : "";
        ratings.push(evidence ? { competency, rating, evidence } : { competency, rating });
      }
    }

    const scorecard: Scorecard = { ratings, source: "human" };
    if (typeof body.summary === "string" && body.summary.trim()) {
      scorecard.summary = body.summary.slice(0, MAX_SUMMARY).trim();
    }
    // Only stamp a recommendation when the recruiter actually picked one; coerce
    // guards against an off-taxonomy value (→ "hold", the safe gate).
    if (isInterviewRecommendation(body.recommendation)) {
      scorecard.recommendation = coerceInterviewRecommendation(body.recommendation);
    }

    const ok = saveHumanScorecard(entry, scorecard);
    if (!ok) {
      return NextResponse.json({ error: "No interview prep to attach a scorecard to — generate it first." }, { status: 404 });
    }

    // DEC1 — close the loop PREP1 left open: this route saved the human verdict
    // and returned, so a human-conducted interview never reached the Decisions
    // queue (the only scorecard_review setters were both AI paths) — the entry
    // stayed parked at the calendar approval and the Interview→Offer gate never
    // opened. When the recruiter recorded an actual recommendation for an active
    // Interview-stage entry whose gate is open (no approval, or still parked at
    // calendar), set the same scorecard_review approval the AI path sets — the
    // human Scorecard (source:"human") already parses as the shape AiReviewCard
    // renders. An entry already holding an AI scorecard_review (or offer_review)
    // is left alone: the human verdict shows beside it via getHumanScorecard.
    let gated = false;
    if (scorecard.recommendation) {
      const pipelineEntry = getPipelineEntry(entry);
      if (
        pipelineEntry &&
        pipelineEntry.status === "active" &&
        pipelineEntry.stage === "Interview" &&
        (pipelineEntry.approvalKind === null || pipelineEntry.approvalKind === "calendar")
      ) {
        setApproval(entry, "scorecard_review", JSON.stringify(scorecard));
        recordAutomationEvent(entry, "interview_scorecard", `human: ${scorecard.recommendation}`);
        gated = true;
      }
    }
    return NextResponse.json({ ok: true, gated });
  } catch (error) {
    return safeJsonError(error, "api:interview-prep:scorecard", "INTERVIEW_PREP_FAILED");
  }
}
