import { NextRequest, NextResponse } from "next/server";
import { getPipelineEntry, recordAutomationEvent, setApproval } from "@/app/_lib/db/pipeline";
import { ensureHumanOnlyPrep, fileHumanScorecard, getInterviewPrep } from "@/app/_lib/interview-prep";
import { humanScorecardViews, ownScorecard, readHumanScorecards, type HumanScorecardKey } from "@/app/_lib/human-scorecard-set";
import { getUserById } from "@/app/_lib/db/users";
import { sealDecisionSafe } from "@/app/_lib/decision-record-store";
import { coerceInterviewRecommendation, isInterviewRecommendation } from "@/app/_lib/interview-recommendation";
import { flagOffRubricRatings, rubricCoverage, rubricForArchetype, rubricVersionHash } from "@/app/_lib/interview-rubric";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";
import { RATING_MAX } from "@/app/_lib/format";
import { MAX_ENTRY_ID_LEN } from "@/app/_lib/entries-param";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";
import { can, currentUser, requireCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { getPipelineAxis } from "@/app/_lib/pipeline-axis-server";
import { stageHasRole } from "@/app/_lib/pipeline-stages";
import type { Scorecard, ScorecardRating } from "@/app/_lib/interview-scorecard";
import { getSubmission } from "@/app/_lib/db/devcase";
import { humanActor } from "@/app/_lib/auth/operator-approver";
import {
  clearAuthorship,
  clearedByFor,
  DebriefFindingError,
  heldForAuthorship,
  readDebriefFindings,
  recordDebriefFindings,
} from "@/app/_lib/devcase-debrief-findings";

// Caps for the human scorecard write (PREP1). The rubric has a handful of
// competencies; evidence/summary are short notes, not documents.
const MAX_RATINGS = 30;
const MAX_COMPETENCY = 200;
const MAX_EVIDENCE = 2_000;
const MAX_SUMMARY = 4_000;
// The byte cap on the body itself, read before the parse: MAX_RATINGS only bounds what is
// kept AFTER it. 30 ratings at full length is about 70 KB, so 128 KB leaves room.
const MAX_SCORECARD_BODY_BYTES = 128 * 1024;

// Abuse containment on the recruiter's verdict write (/perfect wave 37,
// lib-voice-interview-11). It is a read-merge-write that can additionally SET AN
// APPROVAL and seal a decision record, and the operator gate in front of it is a
// documented no-op in open mode. One save per interview is the honest shape, so 60/10 min
// leaves room to edit and re-save without leaving a scripted loop any.
const SCORECARD_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };

// C4 — the debrief findings door. It lives beside the human scorecard because it is the
// same act (an interviewer's recorded judgment) about the same candidate, but it is keyed
// on the SUBMISSION the follow-ups were minted from: `?debrief=<submissionId>`. A foreign
// team's submission answers the same 404 as a missing one.
function debriefState(sub: NonNullable<ReturnType<typeof getSubmission>>) {
  return { ...readDebriefFindings(sub), held: heldForAuthorship(sub), clearedBy: clearedByFor(sub) };
}

function ownedSubmission(ws: string, id: string | null) {
  if (!id || !id.trim() || id.length > MAX_ENTRY_ID_LEN) return null;
  const sub = getSubmission(id);
  return sub && sub.workspaceId === ws ? sub : null;
}

// The caller has already asked `pipeline:write` and passed the route's shared limiter.
async function postDebrief(ws: string, request: NextRequest, submissionId: string) {
  const sub = ownedSubmission(ws, submissionId);
  if (!sub) return jsonRefusal("INTERVIEW_PREP_NOT_FOUND", 404);
  const read = await readJsonWithLimit<{ findings?: unknown; clear?: unknown }>(request, MAX_SCORECARD_BODY_BYTES, {});
  if (read === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_SCORECARD_BODY_BYTES });
  const body = read;
  const actor = await humanActor();
  try {
    if (body.findings !== undefined) recordDebriefFindings(sub, body.findings, actor);
    if (body.clear === true) {
      const verdict = clearAuthorship(sub, actor);
      if (!verdict.cleared) {
        return jsonRefusal(verdict.reason === "not_held" ? "DEBRIEF_NOT_HELD" : "DEBRIEF_CLEARANCE_REFUSED", 409);
      }
    }
  } catch (error) {
    if (error instanceof DebriefFindingError) return jsonRefusal(error.code, 400);
    throw error;
  }
  return NextResponse.json({ ok: true, ...debriefState(sub) });
}

// S1 — the optional "Working with AI tools" axis rides only an entry that already
// carries a work sample (the assignment or the submission it came out of); no new data
// source, and an entry with neither resolves exactly the pre-S1 rubric.
function hasDevCase(entry: { devCaseId?: string | null; devSubmissionId?: string | null }): boolean {
  return Boolean(entry.devCaseId || entry.devSubmissionId);
}

/** The key a caller's scorecard is filed under (r09 schedule-interview-prep/A): WHO
 *  scored — the signed-in user id, null in open mode or on an operator-password
 *  session, which have no identity and so keep today's one slot per round — and WHICH
 *  round — the column the candidate sits in now. The label is resolved once, at write
 *  time, so a reader never needs the users table to say whose record it is. */
async function scorecardKey(stage: string | null): Promise<HumanScorecardKey> {
  const { userId } = await currentUser();
  const user = userId ? getUserById(userId) : null;
  return { author: userId, authorLabel: user ? (user.name ?? user.email) : null, stage };
}

// GET ?entry=<id> -> { mine, records, othersCount }. `mine` is the caller's OWN record for the
// round the candidate is in now — the only thing the scoring form may seed from, so a
// second interviewer opens an empty form instead of the first one's verdict. `records`
// is the panel (every interviewer, every round) once the caller has filed or reviews. Scoped by the same
// getInterviewPrep(entry, ws) read the POST authorizes its write with: another team's
// entry id answers the same 404 as "no prep yet".
export const GET = withWorkspace(async (ws: string, request: NextRequest) => {
  try {
    const debrief = request.nextUrl.searchParams.get("debrief");
    if (debrief !== null) {
      const sub = ownedSubmission(ws, debrief);
      return sub ? NextResponse.json(debriefState(sub)) : jsonRefusal("INTERVIEW_PREP_NOT_FOUND", 404);
    }
    const entry = request.nextUrl.searchParams.get("entry");
    if (!entry || !entry.trim() || entry.length > MAX_ENTRY_ID_LEN) {
      return jsonRefusal("INTERVIEW_ENTRY_REQUIRED", 400);
    }
    const prep = getInterviewPrep(entry, ws);
    const pipelineEntry = getPipelineEntry(entry, ws);
    // No pack yet is an empty form for THIS team's active candidate, the same rule the
    // POST files under. Anything else is the 404 a foreign id has always answered.
    if (!prep && pipelineEntry?.status !== "active") return jsonRefusal("INTERVIEW_PREP_NOT_FOUND", 404);
    const records = prep ? readHumanScorecards(prep.payload) : [];
    const key = await scorecardKey(pipelineEntry?.stage ?? null);
    // `devCase` is the same predicate the POST resolves its rubric with, so the panel
    // offers the optional AI-tools axis exactly when the write will expect it.
    const mine = ownScorecard(records, key.author, key.stage);
    // Independent scoring (human-scorecard-set.ts): a colleague's verdict is not shown
    // until the caller has filed their own for this round, unless they can manage the team
    // (admin/owner, and open mode, which has one identity). The door has no narrower
    // reviewing role; `team:manage` is the closest the capability map offers. Until then
    // only a COUNT crosses the wire, so the panel's "N others scored" stays truthful and
    // nobody learns who filed. What is shown goes through humanScorecardViews: no user id.
    const reveal = mine !== null || (await can("team:manage"));
    return NextResponse.json({
      mine,
      records: reveal ? humanScorecardViews(records) : [],
      othersCount: Math.max(0, records.length - (mine ? 1 : 0)),
      devCase: pipelineEntry ? hasDevCase(pipelineEntry) : false,
    });
  } catch (error) {
    return safeJsonError(error, "api:interview-prep:scorecard", "INTERVIEW_PREP_FAILED");
  }
});

// POST ?entry=<id> → save the caller's human-filled scorecard onto the entry's
// prep artifact, filed under (caller, current round) so it never replaces a
// colleague's record or an earlier round's. Validated field-by-field at the trust boundary (not cast): each
// rating's competency is a bounded string, the rating clamps to [1, RATING_MAX],
// evidence/summary are length-capped, and the recommendation is coerced onto the
// canonical advance|hold|reject set. 404 when no prep artifact exists yet.
export const POST = withWorkspace(async (ws: string, request: NextRequest) => {
  try {
    // AUTHORIZATION (write-routes-check-a-capability). This surface asked NOTHING —
    // not even requireOperator — so authority came down to holding a session, and the
    // entry id is the only other thing the write needs. Every verb here is a recruiter
    // act on another person’s hiring record, so each asks `pipeline:write`. It runs
    // FIRST, ahead of the entry check and the throttle, so a refused seat can neither
    // spend rate-limit budget nor learn which entry ids exist.
    const under = await requireCapabilityCoded("pipeline:write", requireCapability);
    if (under) return under;
    const debrief = request.nextUrl.searchParams.get("debrief");
    const entry = request.nextUrl.searchParams.get("entry");
    if (debrief === null && (!entry || !entry.trim() || entry.length > MAX_ENTRY_ID_LEN)) {
      return jsonRefusal("INTERVIEW_ENTRY_REQUIRED", 400);
    }
    if (!rateLimit(`interview-scorecard:${clientIpFrom(request.headers)}`, SCORECARD_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    if (debrief !== null) return await postDebrief(ws, request, debrief);
    if (!entry) return jsonRefusal("INTERVIEW_ENTRY_REQUIRED", 400);
    const body = await readJsonWithLimit<{
      ratings?: unknown;
      summary?: unknown;
      recommendation?: unknown;
    }>(request, MAX_SCORECARD_BODY_BYTES, {});
    if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_SCORECARD_BODY_BYTES });

    // Resolve the entry once: its archetype + role-family fix the CURRENT rubric
    // (below) and it drives the gating decision at the end.
    //
    // SCOPED. Unscoped, this resolved against the default team, so on any other
    // workspace `pipelineEntry` was null and the whole gating block below was
    // skipped: the scorecard saved with no rubric version and no coverage, and
    // `gated` stayed false forever — a human-led interview never reached the
    // Decisions queue and the Interview -> Offer gate never opened. That is exactly
    // the defect the DEC1 note further down was written to fix.
    const pipelineEntry = getPipelineEntry(entry, ws);
    // TENANCY: `saveHumanScorecard` is an unscoped by-`entry_id` point op, so this was
    // the last verb of the interview-prep surface a foreign entry id could still WRITE
    // through — overwriting another team's interviewer verdict. The workspace predicate
    // rides the read that authorizes the write, exactly as on the other four verbs, and
    // answers the SAME 404 the "no prep yet" path answers: to a caller who does not hold
    // the entry the two are indistinguishable, deliberately.
    //
    // A rating needs no generated plan: the keyless path is a person filing their own
    // verdict, and a candidate with no analyzed profile can never get a plan. The entry
    // read above is the tenant proof, so a foreign id still falls to this 404.
    if (!getInterviewPrep(entry, ws)) {
      if (pipelineEntry?.status !== "active") return jsonRefusal("INTERVIEW_PREP_NOT_FOUND", 404);
      ensureHumanOnlyPrep(entry, pipelineEntry.candidateLabel, pipelineEntry.jobTitle, pipelineEntry.workspaceId);
    }

    // A closed, rejected, declined or hired entry takes no new verdict: filing and
    // sealing one would rewrite the history of a decision already made.
    if (pipelineEntry && pipelineEntry.status !== "active") return jsonRefusal("INTERVIEW_ENTRY_NOT_ACTIVE", 409);

    const parsed: ScorecardRating[] = [];
    if (Array.isArray(body.ratings)) {
      for (const raw of body.ratings) {
        if (parsed.length >= MAX_RATINGS) break;
        if (!raw || typeof raw !== "object") continue;
        const r = raw as Record<string, unknown>;
        const competency = typeof r.competency === "string" ? r.competency.slice(0, MAX_COMPETENCY).trim() : "";
        if (!competency) continue;
        // Only a number or a non-empty numeric string is a rating. `Number(null)`,
        // `Number("")` and `Number(false)` are all 0 and would clamp to the WORST score.
        const n =
          typeof r.rating === "number" ? r.rating : typeof r.rating === "string" && r.rating.trim() ? Number(r.rating) : NaN;
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
    const rubric = pipelineEntry ? rubricForArchetype(pipelineEntry.archetype, pipelineEntry.roleFamily, hasDevCase(pipelineEntry)) : null;
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

    const key = await scorecardKey(pipelineEntry?.stage ?? null);
    const saved = fileHumanScorecard(entry, scorecard, key);
    if (saved === "missing") {
      return jsonRefusal("INTERVIEW_PREP_NOT_FOUND", 404);
    }
    if (saved === "full") {
      return jsonRefusal("INTERVIEW_PREP_SCORECARDS_FULL", 409);
    }

    // Decision SoR (moonshot D backfill): seal the human scorecard verdict —
    // a human actor's recorded judgment. NOT best-effort: no 200 without the record, and
    // the gate below (which routes the entry to the Decisions queue) opens only after it.
    // The scorecard is filed first (its refusals — no prep, list full — must not seal),
    // so a failed seal answers the coded 503 with the scorecard already filed; the retry
    // is idempotent — fileHumanScorecard upserts under the same (author, stage) key, so
    // it replaces that record rather than adding a second — and then seals.
    const rec = scorecard.recommendation ?? "(none)";
    // The seal names the PERSON (`human:<who>`), as the event beside it does; the bare
    // role is only what an identity-less open-mode session resolves to.
    const actor = await humanActor();
    const sealedScorecard = sealDecisionSafe({
      kind: "human_scorecard",
      actor,
      policyVersion: "human",
      candidateRef: entry,
      rationale: `Human interview scorecard — recommendation: ${rec}.`,
      reasonCode: "scorecard",
      // WHO scored and in which round: the interviewer's user id rides the inputs
      // (null in open mode, which has no identity).
      inputs: { recommendation: rec, ratings: ratings.length, author: key.author, stage: key.stage },
    });
    if (!sealedScorecard) {
      console.warn(`[interview-prep:scorecard] scorecard seal failed for ${entry} — answering 503, gate not opened`);
      return jsonRefusal("PIPELINE_DECISION_NOT_SEALED", 503);
    }

    // DEC1 — close the loop PREP1 left open: this route saved the human verdict
    // and returned, so a human-conducted interview never reached the Decisions
    // queue (the only scorecard_review setters were both AI paths) — the entry
    // stayed parked at the calendar approval and the Interview→Offer gate never
    // opened. When the recruiter recorded an actual recommendation for an active
    // interview-role entry whose gate is open (no approval, or still parked at
    // calendar), set the same scorecard_review approval the AI path sets — the
    // human Scorecard (source:"human") already parses as the shape AiReviewCard
    // renders. Meaning is the column's ROLE, not its name: a workspace that
    // renamed Interview to "Loop" (or split it into several interview rounds)
    // still gates; a column that merely kept the id "Interview" after losing
    // the interview role does not. An entry already holding an AI
    // scorecard_review (or offer_review) is left alone: the human verdict shows
    // beside it via getHumanScorecard.
    let gated = false;
    // A recommendation with NO rating behind it does not open the gate: a verdict on
    // nothing is not a scorecard the Decisions queue should be asked to act on.
    if (scorecard.recommendation && ratings.length > 0) {
      if (
        pipelineEntry &&
        pipelineEntry.status === "active" &&
        stageHasRole(pipelineEntry.stage, "interview", getPipelineAxis(ws).stages) &&
        (pipelineEntry.approvalKind === null || pipelineEntry.approvalKind === "calendar")
      ) {
        // COMPARE-AND-SWAP on the approval kind read above: awaits ran since that read
        // (the body, the key), and an AI scorecard_review, an offer_review or a
        // recruiter's resolution landing in the gap must not be overwritten by this card.
        // The event and `gated` follow only a write that actually happened.
        const wrote = setApproval(entry, "scorecard_review", JSON.stringify(scorecard), pipelineEntry.workspaceId, {
          expectedApprovalKind: pipelineEntry.approvalKind,
        });
        if (wrote) {
          // A person's rating: its own kind (never the AI's `interview_scorecard`, which is
          // attributed to automation) and the real actor, so the log badges it HUMAN.
          recordAutomationEvent(
            entry,
            "interview_scorecard_human",
            `human: ${scorecard.recommendation}`,
            pipelineEntry.workspaceId,
            actor
          );
          gated = true;
        }
      }
    }
    return NextResponse.json({ ok: true, gated });
  } catch (error) {
    return safeJsonError(error, "api:interview-prep:scorecard", "INTERVIEW_PREP_FAILED");
  }
});
