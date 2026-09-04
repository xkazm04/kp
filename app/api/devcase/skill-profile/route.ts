import { NextResponse } from "next/server";
import { getSubmission } from "@/app/_lib/db/devcase";
import { issueSkillProfile } from "@/app/_lib/db/skill-profiles";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { requireCapability } from "@/app/_lib/auth/current-user";


// Durable Skill Profile (moonshot A) — mint a signed credential from an evaluated
// dev-case submission (recruiter-triggered from the dev studio). Idempotent per
// submission. Returns the candidate-owned token for the public score-card.
export async function POST(request: Request) {
  // OPERATOR-GATED (/perfect wave 23). Minting a Durable Skill Profile is a RECRUITER
  // act — the studio triggers it from the dev tab — and it is not read-only: a re-mint
  // REVOKES the live credential and reissues under a new token, breaking every /skill
  // link the candidate has already shared. Its ONLY argument was a submission id, and
  // the candidate's own thank-you screen used to print exactly that id at them.
  //
  // Two halves, and it is worth being precise about which does what. The candidate no
  // longer holds the id (the surfaces show an opaque reference — devcase-reference.ts),
  // and this gate is the defence-in-depth half the repo's convention asks of a
  // sensitive write: `proxy.ts` already refuses non-public /api paths in password mode,
  // but a sensitive route re-verifies rather than trusting one gate. Neither half is a
  // gate in OPEN mode (`KP_OPERATOR_PASSWORD` unset makes requireOperator a documented
  // no-op for the whole API) — there, the opacity of the reference is what stands.
  const denied = await requireOperator();
  if (denied) return denied;
  // AUTHORITY (/perfect wave 31). requireOperator above is identity presence, and it
  // says yes to a VIEWER seat exactly as loudly as to an owner. Minting - and, on a
  // moved evaluation, REVOKING and reissuing - a candidate's credential is a recruiter
  // act, so this is the seat question the gate above never asked.
  const forbidden = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (forbidden) return forbidden;
  try {
    const body = (await request.json().catch(() => ({}))) as { submissionId?: unknown };
    const submissionId = typeof body.submissionId === "string" ? body.submissionId.trim() : "";
    if (!submissionId) return jsonRefusal("DEVCASE_SUBMISSION_ID_REQUIRED", 400);
    // TENANCY: issueSkillProfile resolves the submission with getSubmission — a by-id
    // point read on a globally-unique id — so ownership is checked HERE, exactly as
    // /api/devcase/promote and /api/devcase/feedback do. Unguarded, a known submission
    // id from another team minted (or re-read) THEIR candidate's credential and handed
    // back its CSPRNG access token, the sole auth on the public /skill/[token] card —
    // so the caller could then read that candidate's name, case and scores. Worse, the
    // mint is not read-only: it stamps a row into the other team's workspace and, when
    // the evaluation has moved since, REVOKES their live credential and reissues under a
    // new token, breaking every /skill link the candidate had already shared.
    // Same 404 body as a genuinely missing submission — this must not be an oracle.
    const sub = getSubmission(submissionId);
    if (!sub || sub.workspaceId !== (await currentWorkspace())) {
      return jsonRefusal("DEVCASE_SUBMISSION_NOT_FOUND", 404);
    }
    const result = issueSkillProfile(submissionId);
    if (!result.ok) {
      return result.reason === "not_found"
        ? jsonRefusal("DEVCASE_SUBMISSION_NOT_FOUND", 404)
        : jsonRefusal("DEVCASE_SUBMISSION_NOT_EVALUATED", 409);
    }
    return NextResponse.json({ token: result.token, created: result.created });
  } catch (error) {
    // issueSkillProfile is a store transaction plus an HMAC mint: `jsonError` forwarded
    // its message - SQLITE_* detail, the db path, the signing helper's own complaint -
    // straight to the studio. It is a store path, so it answers with a code.
    return safeJsonError(error, "api:devcase/skill-profile", "DEVCASE_SKILL_PROFILE_FAILED");
  }
}
