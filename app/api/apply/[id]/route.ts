import { NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getServerLocale } from "@/i18n/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPipelineEntry,
  findApplicationByApplicant,
  getJob,
  mergeReapplication,
  recordAutomationEvent,
  saveProfile,
  updateProfile,
} from "@/app/_lib/db";
import { applyDedupeKey, buildApplyProfileDraft, buildApplyScript, FALLBACK_ARCHETYPE } from "@/app/_lib/apply";
import { getJobStatus, isJobOpenForApplications } from "@/app/_lib/job-ingest";
import { dispatchApplicationReceived } from "@/app/_lib/comms-dispatch";
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
// 256 KB — ample for a few short answers PLUS the text extracted from an
// optional uploaded CV (the `cv` answer). Still small enough to fail closed on a
// DoS-sized body before buffering it into the heap.
const MAX_APPLY_BODY_BYTES = 256 * 1024;
const MAX_NAME_LENGTH = 200;
const MAX_TEXT_LENGTH = 8 * 1024; // 8 KB per free-text answer (experience, skills)
const MAX_ARCHETYPE_LENGTH = 64; // a registry id, never long
const MAX_EMAIL_LENGTH = 254; // RFC 5321 max address length
const MAX_CV_TEXT_LENGTH = 64 * 1024; // extracted CV text — bounded, head-sampled if longer

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
//
// W8-6 (APP1): `intoProfileId` rebuilds IN PLACE — a re-apply that upgrades an
// existing applicant overwrites their saved profile row instead of minting a
// fresh one, so the candidate pool never grows a stale duplicate of the same
// person. When the id has no profile row (the degraded-stub case: candidateId
// is a random label-only id), updateProfile misses and we fall through to a
// normal save — the caller re-points the entry at the new id.
async function buildApplicantProfile(
  job: ReturnType<typeof getJob>,
  answers: ApplyAnswers,
  intoProfileId?: string | null
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
    const profileFields = {
      label: answers.name,
      archetype,
      roleFamily: (normalized.roleFamily as string) ?? job.roleFamily ?? null,
      completeness,
      payload: normalized,
    };
    if (intoProfileId && updateProfile(intoProfileId, profileFields)) {
      return { ok: true, id: intoProfileId, archetype };
    }
    const saved = saveProfile(profileFields);
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
  const t = await getTranslations("apply");
  return NextResponse.json({ steps: buildApplyScript(job, t) });
}

// Record the renewed interest on the applicant's ORIGINAL entry and return the
// "already applied" acknowledgment. Shared by BOTH dedup paths — the primary
// name-based check and the dedupeKey backstop race — so the event name and
// duplicate flag can never drift between them. The localized `message` (shown to
// the candidate) is passed in by the caller from the request's "apply" catalog.
// W8-6 (APP1): `changes` lists what the merge folded onto the original entry
// (contact backfill, profile rebuild); it lands in the event detail so the feed
// shows WHAT a repeat contributed, not just that one happened.
function acknowledgeReapply(entryId: string, message: string, changes: string[] = []): NextResponse {
  const detail = changes.length
    ? `repeat application via conversational apply — ${changes.join("; ")}`
    : "repeat application via conversational apply";
  recordAutomationEvent(entryId, "re_applied", detail);
  return NextResponse.json({ result: "accepted", duplicate: true, message });
}

// POST → evaluate KO answers. Pass → create an Accepted pipeline entry; fail → a
// polite decline (no entry created).
//
// Duplicate-application policy: one application per (applicant, role). A repeat
// submission from the same person does NOT create a second entry — its fresh
// signals MERGE onto the original (contact backfill, profile rebuild — see the
// W8-6 block below), a `re_applied` event records what the repeat contributed,
// and the applicant gets an "already applied" acknowledgment. Identity is the
// email when captured, else the normalized name; see findApplicationByApplicant
// and applyDedupeKey.
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "Role not found." }, { status: 404 });

    // Candidate-facing outcome messages (returned in the JSON and shown verbatim
    // in the chat) are localized from the request's "apply" catalog.
    const t = await getTranslations("apply");
    // SIM3 — the language the candidate applied in, persisted on the entry so
    // every downstream comm (ack/rejection/interview/offer/onboarding) renders
    // in it rather than defaulting to English.
    const applicantLocale = await getServerLocale();

    // W8-1 (JOB1) — a closed/draft role refuses the SUBMISSION too (the page
    // gate alone is the documented anti-pattern: the API used to accept
    // applications for any existing job forever, drafts included).
    if (!isJobOpenForApplications(getJobStatus(id))) {
      return NextResponse.json({ error: t("roleClosed") }, { status: 410 });
    }

    // Reject an oversized body BEFORE buffering it into the heap. Content-Length is
    // the only pre-read signal; the per-field caps below backstop an absent/spoofed one.
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_APPLY_BODY_BYTES) {
      return NextResponse.json({ error: "Application payload too large." }, { status: 413 });
    }

    const body = (await request.json().catch(() => ({}))) as { answers?: Record<string, unknown> };
    const answers = body.answers ?? {};

    // Knockout gate. Derive THIS job's KO steps from its own script (ko_mode/ko_lang are
    // conditional on workMode/languages) and require every expected KO answer to be present
    // AND explicitly true. The POST body is the public, untrusted trust boundary — the old
    // "decline only if a KO key is present and === false" treated an ABSENT key as a pass, so
    // a scripted POST could skip work-authorization / mode / language eligibility by simply
    // omitting the keys and still land an Accepted entry. Missing-or-not-true now declines.
    const expectedKoIds = buildApplyScript(job, t)
      .filter((s) => s.type === "ko")
      .map((s) => s.id);
    const passedKo = expectedKoIds.every((koId) => answers[koId] === true);
    if (!passedKo) {
      return NextResponse.json({
        result: "declined",
        message: t("declinedMessage"),
      });
    }

    // The provided name drives the duplicate-application policy; the "Applicant"
    // fallback is a display label only. We never dedup on the fallback — two
    // anonymous applicants must not be merged into one entry — so the dedup key
    // is derived from `providedName` (blank ⇒ no dedup).
    const providedName = String(answers.name ?? "").trim();
    const name = providedName || "Applicant";
    const email = String(answers.email ?? "").trim();
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
    // Optional CV: the client already extracted the file's text via
    // /api/extract-text and sent it as the `cv` answer. Head-sample (don't reject)
    // an over-long extract — it's evidence, not an exact field, and the most
    // relevant content sits at the top of a CV.
    const cvText = String(answers.cv ?? "").trim().slice(0, MAX_CV_TEXT_LENGTH);

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
    // Apply doesn't HARD-block on a missing email (the entry still files; comms
    // just stay undeliverable until a contact is captured) — but a clearly
    // malformed address is rejected so the stored recipient is never junk.
    if (email.length > MAX_EMAIL_LENGTH) {
      return NextResponse.json({ error: "Your email is too long." }, { status: 400 });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    // Duplicate-application policy (primary check): if this named applicant has
    // already applied to this role, surface the repeat on the original entry and
    // acknowledge it — don't create a second pipeline row. Dedup keys on the
    // EMAIL when given (the stronger identity), else the name — so two same-named
    // applicants with different addresses no longer merge.
    //
    // W8-6 (APP1) — merge, don't drop. Re-applying is the only self-service
    // "update my info" path an applicant has, so a detected repeat folds its
    // fresh signals onto the original entry before acknowledging:
    //   - a valid email backfills a contactless entry (the applicant becoming
    //     reachable is the point of re-applying for most);
    //   - a CV-carrying repeat (or any repeat on a degraded stub) rebuilds the
    //     profile — in place for a healthy original, a fresh save + re-point for
    //     the stub. A FAILED rebuild touches nothing: a junk repeat can never
    //     degrade a healthy entry, and a stub just stays a stub.
    if (providedName || email) {
      const existing = findApplicationByApplicant(job.id, providedName, email);
      if (existing) {
        const changes: string[] = [];
        const updates: { contact?: string; candidateId?: string; archetype?: string | null } = {};
        if (email && !existing.contact) {
          updates.contact = email;
          changes.push("contact email captured");
        }
        if (cvText || existing.intakeDegraded) {
          const rebuilt = await buildApplicantProfile(
            job,
            {
              name,
              experience,
              skills,
              archetype,
              studentProject,
              studentEducation,
              studentAspirations,
              switchPrior,
              switchAspirations,
              cvText,
            },
            existing.candidateId
          );
          if (rebuilt.ok) {
            updates.candidateId = rebuilt.id;
            updates.archetype = rebuilt.archetype;
            changes.push(
              existing.intakeDegraded ? "degraded intake recovered (profile rebuilt)" : "profile rebuilt with CV"
            );
          }
        }
        if (changes.length > 0) {
          const merged = mergeReapplication(existing.id, updates);
          // Newly reachable: the original acknowledgment dead-lettered (no
          // recipient existed), so send it to the address just captured.
          // Best-effort, same contract as the first-apply ack below.
          if (updates.contact && merged) {
            try {
              await dispatchApplicationReceived(merged);
            } catch (ackErr) {
              console.error(
                `[apply] re-apply merged but acknowledgement failed for entry ${merged.id}:`,
                ackErr instanceof Error ? ackErr.message : ackErr
              );
            }
          }
        }
        return acknowledgeReapply(existing.id, t("alreadyMessage"), changes);
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
      cvText,
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
      dedupeKey: applyDedupeKey(providedName, email),
      intakeDegraded: !built.ok,
      intakeDegradedReason: built.ok ? null : built.reason,
      // The deliverable recipient for every downstream comm; null when the
      // applicant left it blank (the entry still files, comms just dead-letter).
      contact: email || null,
      // SIM3 — the applicant's language, so downstream comms speak it.
      locale: applicantLocale,
    });

    // created:false here means the dedupeKey backstop caught a concurrent repeat
    // submission — surface it as a re-apply rather than logging a second
    // "applied" against the same entry.
    if (!created) {
      return acknowledgeReapply(entry.id, t("alreadyMessage"));
    }

    // createPipelineEntry already logs an `intake_degraded` event for the stub; for
    // a healthy intake record the usual `applied` provenance. The event detail is
    // whichever lane's story the applicant told.
    if (built.ok) {
      const story = experience || studentProject || switchPrior;
      recordAutomationEvent(entry.id, "applied", story ? story.slice(0, 160) : "via conversational apply");
    }

    // Acknowledge the application (APP3) — a durable "we received it" instead of
    // only the in-page bubble. Best-effort: the entry is already created, so a
    // comms failure must never turn a successful application into a 500. Lands in
    // the Outbox (deliverable when an email was captured above, traceable either
    // way). Fires for degraded stubs too — they still applied.
    try {
      await dispatchApplicationReceived(entry);
    } catch (ackErr) {
      console.error(
        `[apply] application accepted but acknowledgement failed for entry ${entry.id}:`,
        ackErr instanceof Error ? ackErr.message : ackErr
      );
    }

    return NextResponse.json({
      result: "accepted",
      message: t("acceptedMessage"),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "apply failed" }, { status: 500 });
  }
}
