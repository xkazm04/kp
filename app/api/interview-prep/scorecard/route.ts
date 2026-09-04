import { NextRequest, NextResponse } from "next/server";
import { getPipelineEntry, recordAutomationEvent, setApproval } from "@/app/_lib/db/pipeline";
import { getInterviewPrep, saveHumanScorecard } from "@/app/_lib/interview-prep";
import { sealDecisionSafe } from "@/app/_lib/decision-record-store";
import { coerceInterviewRecommendation, isInterviewRecommendation } from "@/app/_lib/interview-recommendation";
import { flagOffRubricRatings, rubricCoverage, rubricForArchetype, rubricVersionHash } from "@/app/_lib/interview-rubric";
import { RATING_MAX } from "@/app/_lib/format";
import { MAX_ENTRY_ID_LEN } from "@/app/_lib/entries-param";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import type { Scorecard, ScorecardRating } from "@/app/_lib/interview-scorecard";


// Caps for the human scorecard write (PREP1). The rubric has a handful of
// competencies; evidence/summary are short notes, not documents.
const MAX_RATINGS = 30;
const MAX_COMPETENCY = 200;
const MAX_EVIDENCE = 2_000;
const MAX_SUMMARY = 4_000;

// Abuse containment on the recruiter's verdict write (/perfect wave 37,
// lib-voice-interview-11). It is a read-merge-write that can additionally SET AN
// APPROVAL and seal a decision record, and the operator gate in front of it is a
// documented no-op in open mode. One save per interview is the honest shape, so 60/10 min
// leaves room to edit and re-save without leaving a scripted loop any.
const SCORECARD_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };

// POST ?entry=<id> → save the recruiter's human-filled scorecard onto the entry's
// prep artifact. Validated field-by-field at the trust boundary (not cast): each
// rating's competency is a bounded string, the rating clamps to [1, RATING_MAX],
// evidence/summary are length-capped, and the recommendation is coerced onto the
// canonical advance|hold|reject set. 404 when no prep artifact exists yet.
export async function POST(request: NextRequest) {
  try {
    // AUTHORIZATION (write-routes-check-a-capability). This surface asked NOTHING —
    // not even requireOperator — so authority came down to holding a session, and the
    // entry id is the only other thing the write needs. Every verb here is a recruiter
    // act on another person’s hiring record, so each asks `pipeline:write`. It runs
    // FIRST, ahead of the entry check and the throttle, so a refused seat can neither
    // spend rate-limit budget nor learn which entry ids exist.
    const under = await requireCapabilityCoded("pipeline:write", requireCapability);
    if (under) return under;
    const entry = request.nextUrl.searchParams.get("entry");
    if (!entry || !entry.trim() || entry.length > MAX_ENTRY_ID_LEN) {
      return jsonRefusal("INTERVIEW_ENTRY_REQUIRED", 400);
    }
    if (!rateLimit(`interview-scorecard:${clientIpFrom(request.headers)}`, SCORECARD_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const body = (await request.json().catch(() => ({}))) as {
      ratings?: unknown;
      summary?: unknown;
      recommendation?: unknown;
    };

    // Resolve the entry once: its archetype + role-family fix the CURRENT rubric
    // (below) and it drives the gating decision at the end.
    //
    // SCOPED. Unscoped, this resolved against the default team, so on any other
    // workspace `pipelineEntry` was null and the whole gating block below was
    // skipped: the scorecard saved with no rubric version and no coverage, and
    // `gated` stayed false forever — a human-led interview never reached the
    // Decisions queue and the Interview -> Offer gate never opened. That is exactly
    // the defect the DEC1 note further down was written to fix.
    const ws = await currentWorkspace();
    const pipelineEntry = getPipelineEntry(entry, ws);
    // TENANCY: `saveHumanScorecard` is an unscoped by-`entry_id` point op, so this was
    // the last verb of the interview-prep surface a foreign entry id could still WRITE
    // through — overwriting another team's interviewer verdict. The workspace predicate
    // rides the read that authorizes the write, exactly as on the other four verbs, and
    // answers the SAME 404 the "no prep yet" path answers: to a caller who does not hold
    // the entry the two are indistinguishable, deliberately.
    if (!getInterviewPrep(entry, ws)) {
      return jsonRefusal("INTERVIEW_PREP_NOT_FOUND", 404);
    }

    const parsed: ScorecardRating[] = [];
    if (Array.isArray(body.ratings)) {
      for (const raw of body.ratings) {
        if (parsed.length >= MAX_RATINGS) break;
        if (!raw || typeof raw !== "object") continue;
        const r = raw as Record<string, unknown>;
        const competency = typeof r.competency === "string" ? r.competency.slice(0, MAX_COMPETENCY).trim() : "";
        if (!competency) continue;
        const n = typeof r.rating === "number" ? r.rating : Number(r.rating);
        if (!Number.isFinite(n)) continue; // an unrated competency is simply omitted
        const rating = Math.min(RATING_MAX, Math.max(1, Math.round(n)));
        const evidence = typeof r.evidence === "string" ? r.evidence.slice(0, MAX_EVIDENCE).trim() : "";
        parsed.push(evidence ? { competency, rating, evidence } : { competency, rating });
      }
    }

    // Validate competencies against the entry's own rubric (archetype + role-family).
    // The client sends whatever competency strings it rendered; a value that isn't in
    // the current rubric is KEPT but flagged off-rubric — the same concept
    // CompareInterviews surfaces — rather than rejected, since a record must outlive
    // rubric revisions. Without a resolvable entry there's no rubric to judge against,
    // so the ratings pass through unflagged.
    // Resolve the entry's CURRENT rubric ONCE: it both flags off-rubric ratings at
    // write time AND is the snapshot we stamp so this record can be re-evaluated
    // against the exact scale later, after the rubric revises (Direction 2).
    const rubric = pipelineEntry ? rubricForArchetype(pipelineEntry.archetype, pipelineEntry.roleFamily) : null;
    const coverage = pipelineEntry ? rubricCoverage(pipelineEntry.roleFamily) : null;
    const ratings: ScorecardRating[] = rubric ? flagOffRubricRatings(parsed, rubric) : parsed;

    const scorecard: Scorecard = { ratings, source: "human" };
    // Stamp the rubric version + its competency keys (Direction 2). Without a
    // resolvable entry there's no rubric to stamp — a legacy-shaped record that
    // consumers re-evaluate against the current rubric, exactly as before.
    if (rubric) {
      scorecard.rubricVersion = rubricVersionHash(rubric);
      scorecard.rubricKeys = rubric.map((c) => c.competency);
      // …and WHAT it covered. The recruiter saw the coverage note in the form; the
      // stored record must say the same thing, or a later reader re-opening this
      // scorecard sees five generic axes with nothing marking the industry axes as
      // never-applied. Same pure resolver the form renders from.
      if (coverage) scorecard.rubricCoverage = coverage;
    }
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
      return jsonRefusal("INTERVIEW_PREP_NOT_FOUND", 404);
    }

    // Decision SoR (moonshot D backfill): seal the human scorecard verdict —
    // a human actor's recorded judgment. Best-effort; never blocks the save.
    const rec = scorecard.recommendation ?? "(none)";
    sealDecisionSafe({
      kind: "human_scorecard",
      actor: "human:recruiter",
      policyVersion: "human",
      candidateRef: entry,
      rationale: `Human interview scorecard — recommendation: ${rec}.`,
      reasonCode: "scorecard",
      inputs: { recommendation: rec, ratings: ratings.length },
    });

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
      if (
        pipelineEntry &&
        pipelineEntry.status === "active" &&
        pipelineEntry.stage === "Interview" &&
        (pipelineEntry.approvalKind === null || pipelineEntry.approvalKind === "calendar")
      ) {
        setApproval(entry, "scorecard_review", JSON.stringify(scorecard), pipelineEntry.workspaceId);
        recordAutomationEvent(entry, "interview_scorecard", `human: ${scorecard.recommendation}`, pipelineEntry.workspaceId);
        gated = true;
      }
    }
    return NextResponse.json({ ok: true, gated });
  } catch (error) {
    return safeJsonError(error, "api:interview-prep:scorecard", "INTERVIEW_PREP_FAILED");
  }
}
