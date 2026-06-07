import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPipelineEntry,
  findApplicationByApplicant,
  getJob,
  recordAutomationEvent,
  saveProfile,
} from "@/app/_lib/db";
import { applyDedupeKey, buildApplyProfileDraft, buildApplyScript, FALLBACK_ARCHETYPE, KO_STEP_IDS } from "@/app/_lib/apply";
import type { ApplyAnswers } from "@/app/_lib/apply-intake";
import { cleanupWorkdir, createWorkdir, parsePythonJson, spawnPython } from "@/app/_lib/python-runner";
import { validateProfileCliResult } from "@/app/_lib/apply-profile-result";
import { randomId } from "@/app/_lib/random-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Input caps for this PUBLIC, unauthenticated, side-effecting endpoint. Without
// them a single POST can buffer a multi-hundred-MB body in the Node heap
// (request.json), then get written to the temp disk (intake.json) and fed to a
// Python subprocess — a trivial memory/disk DoS. Fail closed at the trust boundary.
const MAX_APPLY_BODY_BYTES = 64 * 1024; // 64 KB — ample for a few short answers
const MAX_NAME_LENGTH = 200;
const MAX_TEXT_LENGTH = 8 * 1024; // 8 KB per free-text answer (experience, skills)
const MAX_ARCHETYPE_LENGTH = 64; // a registry id, never long

// Outcome of normalizing an application into a matchable profile. On failure we
// carry a short, bounded `reason` (not just null) so the caller can persist it
// on the pipeline entry — turning the silent demotion into a recruiter-visible
// "needs manual capture" signal instead of a server-log-only event.
type BuildOutcome =
  | { ok: true; id: string; archetype: string | null }
  | { ok: false; reason: string };

const DEGRADED_REASON_MAX = 280;

// Keep the persisted reason short and single-line: it lands in a DB column and a
// compact recruiter UI, and raw Python stderr can be huge/multiline.
function degradedReason(detail: string): string {
  const oneLine = detail.replace(/\s+/g, " ").trim() || "intake normalization failed";
  return oneLine.length > DEGRADED_REASON_MAX ? `${oneLine.slice(0, DEGRADED_REASON_MAX - 1)}…` : oneLine;
}

// Normalize the captured answers into a saved CandidateProfileV2 (the same
// profile_cli path the Profile form uses). Returns the saved profile's id +
// archetype on success, or a failure reason — the caller falls back to a
// label-only entry (flagged intake-degraded) so applying never hard-errors.
async function buildApplicantProfile(
  job: ReturnType<typeof getJob>,
  answers: ApplyAnswers
): Promise<BuildOutcome> {
  if (!job) return { ok: false, reason: degradedReason("role not found at intake") };
  let workdir: string | null = null;
  try {
    const { profile, signals } = buildApplyProfileDraft(job, answers);
    workdir = await createWorkdir();
    const inputPath = path.join(workdir, "intake.json");
    await writeFile(inputPath, JSON.stringify({ profile, signals }), "utf-8");
    const { result } = spawnPython(["-m", "pipeline.jobfit.profile_cli", "--input-json", inputPath]);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      // Surface the failing exit code plus the tail of stderr (the most likely
      // line to name the cause) so the recruiter signal is diagnosable.
      const tail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? "";
      return {
        ok: false,
        reason: degradedReason(`profile normalization exited ${exitCode}${tail ? `: ${tail}` : ""}`),
      };
    }
    // Parse the result JSON line via parsePythonJson (which scans from the end
    // for the first object/array), not the whole buffer: a stray warning/
    // deprecation/print or trailing interpreter shutdown line would otherwise
    // make JSON.parse throw and silently demote the applicant to a label-only,
    // non-matchable stub.
    const parsed = parsePythonJson<unknown>(stdout, stderr);
    // parsePythonJson only guarantees "some JSON object/array" — not the shape
    // profile_cli promises. Validate the trust boundary so an exit-0 CLI that
    // drifts to `{}` / `{profile:null}` / a partial object yields a clear degraded
    // reason instead of an incidental TypeError, and is never saved as junk.
    const validation = validateProfileCliResult(parsed);
    if (!validation.ok) {
      return { ok: false, reason: degradedReason(validation.reason) };
    }
    const { profile: normalized, archetype, completeness } = validation.value;
    const saved = saveProfile({
      label: answers.name,
      archetype,
      roleFamily: (normalized.roleFamily as string) ?? job.roleFamily ?? null,
      completeness,
      payload: normalized,
    });
    return { ok: true, id: saved.id, archetype };
  } catch (err) {
    // Don't swallow silently: a failed build demotes the applicant to a
    // label-only, non-matchable stub, so make that degradation visible — both in
    // the server log and (via the returned reason) on the recruiter's board.
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[apply] buildApplicantProfile failed for job ${job.id}; falling back to a non-matchable stub:`,
      message,
    );
    return { ok: false, reason: degradedReason(message) };
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}

// GET → the conversational apply script for a job (capture + KO questions).
// The apply PAGE no longer hits this route on load: page.tsx server-builds the
// same script (buildApplyScript) from its own getJob and passes it to the client
// as a prop, sparing a round-trip and a duplicate getJob per page view. This
// route is retained for any standalone use of the script.
// SINGLE SOURCE OF TRUTH: page.tsx owns the apply header (role title / company),
// rendered from its own server-side getJob. This endpoint deliberately returns
// ONLY `steps` — no `job` payload — so there is no second, divergent read of the
// same record for a caller to (mis)use.
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "Role not found." }, { status: 404 });
  return NextResponse.json({ steps: buildApplyScript(job) });
}

// Friendly acknowledgment shown when a passing applicant submits a SECOND time
// for the same role. Duplicate-application policy is dedup + surface: their first
// application is the one that stands, repeats don't create a second pipeline row.
const ALREADY_APPLIED_MESSAGE =
  "Thanks for your enthusiasm! It looks like you've already applied to this role — your earlier application is in our pipeline and a recruiter will be in touch. We've noted your renewed interest.";

// Record the renewed interest on the applicant's ORIGINAL entry and return the
// "already applied" acknowledgment. Shared by BOTH dedup paths — the primary
// name-based check and the dedupeKey backstop race — so the event name, message,
// and duplicate flag can never drift between them.
function acknowledgeReapply(entryId: string): NextResponse {
  recordAutomationEvent(entryId, "re_applied", "repeat application via conversational apply");
  return NextResponse.json({ result: "accepted", duplicate: true, message: ALREADY_APPLIED_MESSAGE });
}

// POST → evaluate KO answers. Pass → create an Accepted pipeline entry; fail → a
// polite decline (no entry created).
//
// Duplicate-application policy: one application per (applicant, role). A repeat
// submission from the same person does NOT create a second entry — we record a
// `re_applied` event on their original entry (so the renewed interest is visible
// to recruiters rather than silently dropped or silently duplicated) and return
// an "already applied" acknowledgment. Dedup is keyed on (jobId + normalized
// name) since the flow captures no contact field; see findApplicationByApplicant
// and applyDedupeKey.
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "Role not found." }, { status: 404 });

    // Reject an oversized body BEFORE buffering it into the heap. Content-Length is
    // the only pre-read signal; the per-field caps below backstop an absent/spoofed one.
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_APPLY_BODY_BYTES) {
      return NextResponse.json({ error: "Application payload too large." }, { status: 413 });
    }

    const body = (await request.json().catch(() => ({}))) as { answers?: Record<string, unknown> };
    const answers = body.answers ?? {};

    // A "no" on any KO question declines the application.
    const failedKo = KO_STEP_IDS.some((k) => k in answers && answers[k] === false);
    if (failedKo) {
      return NextResponse.json({
        result: "declined",
        message:
          "Thanks for your interest! Based on your answers this role isn't the right fit right now, but we'd welcome a future application as our openings evolve.",
      });
    }

    // The provided name drives the duplicate-application policy; the "Applicant"
    // fallback is a display label only. We never dedup on the fallback — two
    // anonymous applicants must not be merged into one entry — so the dedup key
    // is derived from `providedName` (blank ⇒ no dedup).
    const providedName = String(answers.name ?? "").trim();
    const name = providedName || "Applicant";
    const experience = String(answers.experience ?? "").trim();
    const skills = String(answers.skills ?? "").trim();
    const archetype = String(answers.archetype ?? "").trim();
    // Early-career lane answers (step ids from buildApplyScript) — exactly one
    // lane's fields arrive per application; the others stay "".
    const studentProject = String(answers.student_project ?? "").trim();
    const studentEducation = String(answers.student_education ?? "").trim();
    const studentAspirations = String(answers.student_aspirations ?? "").trim();
    const switchPrior = String(answers.switch_prior ?? "").trim();
    const switchAspirations = String(answers.switch_aspirations ?? "").trim();

    // Per-field caps — fail closed BEFORE the dedup query, profile build, intake.json
    // write, or Python spawn. Reject (don't truncate) so the applicant fixes the input.
    if (name.length > MAX_NAME_LENGTH) {
      return NextResponse.json({ error: "Your name is too long." }, { status: 400 });
    }
    const freeText = [experience, skills, studentProject, studentEducation, studentAspirations, switchPrior, switchAspirations];
    if (freeText.some((t) => t.length > MAX_TEXT_LENGTH)) {
      return NextResponse.json({ error: "One of your answers is too long — please shorten it." }, { status: 400 });
    }
    if (archetype.length > MAX_ARCHETYPE_LENGTH) {
      return NextResponse.json({ error: "Invalid selection." }, { status: 400 });
    }

    // Duplicate-application policy (primary check): if this named applicant has
    // already applied to this role, surface the repeat on the original entry and
    // acknowledge it — don't create a second pipeline row or burn a profile build.
    if (providedName) {
      const existing = findApplicationByApplicant(job.id, providedName);
      if (existing) {
        return acknowledgeReapply(existing.id);
      }
    }

    // Build a real, matchable V2 candidate from the answers; on failure fall back
    // to a label-only id AND flag the entry intake-degraded so the recruiter sees
    // a stub that needs manual profile capture (rather than a silent demotion).
    const built = await buildApplicantProfile(job, {
      name,
      experience,
      skills,
      archetype,
      studentProject,
      studentEducation,
      studentAspirations,
      switchPrior,
      switchAspirations,
    });
    const candidateId = built.ok ? built.id : randomId("apply");

    const { entry, created } = createPipelineEntry({
      candidateId,
      candidateLabel: name,
      // A degraded intake (or a build with no archetype) takes the neutral baseline
      // — never a guessed fairness-shielded archetype. See FALLBACK_ARCHETYPE.
      archetype: (built.ok ? built.archetype : null) ?? FALLBACK_ARCHETYPE,
      roleFamily: job.roleFamily ?? null,
      jobId: job.id,
      jobTitle: job.title,
      stage: "Accepted",
      // Stable per-applicant key so the entry dedups on (name, job) even though
      // candidateId is a fresh profile id each submission. Backstops the rare
      // race where two concurrent first-time submissions slip past the check
      // above (each builds its own profile, but they collapse to one entry).
      dedupeKey: applyDedupeKey(providedName),
      intakeDegraded: !built.ok,
      intakeDegradedReason: built.ok ? null : built.reason,
    });

    // created:false here means the dedupeKey backstop caught a concurrent repeat
    // submission — surface it as a re-apply rather than logging a second
    // "applied" against the same entry.
    if (!created) {
      return acknowledgeReapply(entry.id);
    }

    // createPipelineEntry already logs an `intake_degraded` event for the stub; for
    // a healthy intake record the usual `applied` provenance. The event detail is
    // whichever lane's story the applicant told.
    if (built.ok) {
      const story = experience || studentProject || switchPrior;
      recordAutomationEvent(entry.id, "applied", story ? story.slice(0, 160) : "via conversational apply");
    }

    return NextResponse.json({
      result: "accepted",
      message:
        "You're in! Thanks for applying — a recruiter will review your profile and reach out about next steps shortly.",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "apply failed" }, { status: 500 });
  }
}
