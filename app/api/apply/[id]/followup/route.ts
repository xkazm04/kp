import { NextRequest, NextResponse } from "next/server";
import { getJob, getJobWorkspace } from "@/app/_lib/db/jobs";
import { entryProfileGaps, findEntryByLeadToken, recordAutomationEvent, setEntryProfileGaps } from "@/app/_lib/db/pipeline";
import { getProfileRecord } from "@/app/_lib/db/profiles";
import { coerceLeadTokenParam } from "@/app/_lib/apply-intake";
import { GAP_FIELDS, mergeGapAnswers } from "@/app/_lib/completeness-followup";
import { renormalizeApplicantProfile } from "@/app/_lib/applicant-profile";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { safeJsonError } from "@/app/_lib/api-response";

// The candidate's answers to the profile-completeness gap questions, posted from
// the done screen of the conversational apply AFTER their application has already
// been filed. profile_cli reports these gaps on every profile build; the recruiter
// has always been able to fill them in (ArchetypeBanner), but the only person who
// actually knows the answers never got asked. This route closes that loop.
//
// AUTH: the entry is addressed by its opaque lead-enrichment token — the SAME
// CSPRNG capability ("this candidate may enrich this entry") the ack email's
// "complete your profile" link already carries, resolved through
// findEntryByLeadToken. NEVER a bare entry id from the client, which is an
// internal IDOR handle. The token's entry must also belong to the job in the URL,
// so a token for one role can't be replayed against another.
//
// The merge itself mirrors the recruiter's "Save as profile" semantics exactly
// (mergeGapAnswers into the stored payload, then the deterministic profile_cli
// re-route + re-score, updated in place) — no new LLM call, no schema change.

// Bounded like both sibling apply routes: this spawns profile_cli, so a flood of
// small bodies must be cheap to refuse. Lower than the apply routes' own limits —
// a candidate answers this once, twice if they retry.
const FOLLOWUP_RATE_LIMIT = { limit: 10, windowMs: 60_000 };

// A few short free-text answers. Nothing here carries a CV.
const MAX_FOLLOWUP_BODY_BYTES = 16 * 1024;
const MAX_ANSWER_LENGTH = 2 * 1024;
const MAX_ANSWERS = 12;

// Deliberately identical for "no such token", "token for another job", and "entry
// has no profile row": a public capability route must not let a caller probe
// which of those it hit.
const NOT_FOUND = { error: "not found" };

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    // Throttle BEFORE any DB read or Python spawn.
    if (!rateLimit(`apply-followup:${id}:${clientIpFrom(request.headers)}`, FOLLOWUP_RATE_LIMIT)) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_FOLLOWUP_BODY_BYTES) {
      return NextResponse.json({ error: "Payload too large." }, { status: 413 });
    }
    const job = getJob(id);
    if (!job) return NextResponse.json(NOT_FOUND, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as { lead?: unknown; answers?: unknown };

    // Shape-gate the token before it touches the DB (never a cast), then resolve
    // it to its entry — and require that entry to belong to THIS job.
    const token = coerceLeadTokenParam(body.lead);
    const target = token ? findEntryByLeadToken(token) : null;
    if (!target || target.entry.jobId !== job.id) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    const entry = target.entry;
    // Same tenant the application filed into (a public candidate has no session).
    const workspaceId = getJobWorkspace(job.id);

    // Only answers to gaps ACTUALLY RECORDED for this entry are accepted, and only
    // for checks this build knows how to ask about. So a scripted POST can neither
    // invent a field nor re-open a gap the candidate already closed — the recorded
    // list is the whole authority.
    const recorded = new Set(entryProfileGaps(entry.id, workspaceId).map((g) => g.check));
    const raw = body.answers;
    const answers: Record<string, string> = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [check, value] of Object.entries(raw as Record<string, unknown>)) {
        if (Object.keys(answers).length >= MAX_ANSWERS) break;
        if (!recorded.has(check) || !GAP_FIELDS[check]) continue;
        const text = typeof value === "string" ? value.trim().slice(0, MAX_ANSWER_LENGTH) : "";
        if (text) answers[check] = text;
      }
    }
    // Nothing usable — a no-op success, never an error: the candidate's
    // application is already filed and a skipped/blank follow-up loses nothing.
    if (Object.keys(answers).length === 0) {
      return NextResponse.json({ ok: true, merged: 0 });
    }

    // The entry's saved profile. A degraded stub (candidateId is a random
    // label-only id) has no row — nothing to merge into, and no gaps would have
    // been recorded for it either.
    const profileId = entry.candidateId;
    const record = profileId ? getProfileRecord(profileId, workspaceId) : null;
    if (!profileId || !record || typeof record.payload !== "object" || record.payload === null) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    // Fold the answers in (self_declared provenance for skills, TYPED evidence for
    // the free-text stories — mergeGapAnswers owns that contract), then re-route +
    // re-score through profile_cli, in place. `missingGaps` comes back
    // authoritative, so a gap the answer didn't actually close STAYS recorded.
    const merged = mergeGapAnswers(record.payload as Record<string, unknown>, answers);
    const rebuilt = await renormalizeApplicantProfile(profileId, merged, entry.candidateLabel, workspaceId);
    if (!rebuilt.ok) {
      // The saved profile is untouched (renormalize writes only on success), so
      // the recorded gaps stay too — the candidate can retry, and the recruiter
      // still sees exactly what is missing.
      console.error(`[apply:followup] gap merge failed for entry ${entry.id}: ${rebuilt.reason}`);
      return NextResponse.json({ error: "Could not save your answers." }, { status: 500 });
    }

    setEntryProfileGaps(entry.id, rebuilt.missingGaps, workspaceId);
    // Provenance on the candidate's own timeline: the recruiter sees WHERE the
    // newly-complete profile came from, not just that it changed.
    recordAutomationEvent(
      entry.id,
      "profile_enriched",
      `candidate answered ${Object.keys(answers).length} profile follow-up question(s): ${Object.keys(answers).join(", ")}`,
      workspaceId
    );

    return NextResponse.json({ ok: true, merged: Object.keys(answers).length });
  } catch (error) {
    // Public + unauthenticated: same hygiene as both apply routes and /api/status.
    return safeJsonError(error, "api:apply:followup", "FOLLOWUP_FAILED");
  }
}
