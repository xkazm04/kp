import { NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getServerLocale } from "@/i18n/server";
import {
  createPipelineEntry,
  findApplicationByApplicant,
  findEntryByLeadToken,
  getJob,
  getJobWorkspace,
  mergeReapplication,
  recordAutomationEvent,
  recordEntryConsent,
  recordKnockoutDecline,
} from "@/app/_lib/db";
import { applyDedupeKey, applyKoSteps, FALLBACK_ARCHETYPE } from "@/app/_lib/apply";
import { ANONYMOUS_APPLICANT_LABEL, APPLY_EMAIL_RE, coerceGithubHandle, coerceLeadTokenParam, failedKoStepIds } from "@/app/_lib/apply-intake";
import { getJobStatus, isJobOpenForApplications } from "@/app/_lib/job-ingest";
import { dispatchApplicationReceived } from "@/app/_lib/comms-dispatch";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import type { ApplyAnswers } from "@/app/_lib/apply-intake";
import { buildApplicantProfile } from "@/app/_lib/applicant-profile";
import { randomId } from "@/app/_lib/random-id";
import { getOrCreateStatusLink } from "@/app/_lib/application-status-store";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";

// Mint (or reuse) the candidate's status-link token for an entry (idea-e76a6fb2),
// best-effort: the application already succeeded, so a status-link failure must
// never turn it into an error — the candidate just doesn't get the tracking link.
function safeStatusLink(entryId: string): string | null {
  try {
    return getOrCreateStatusLink(entryId);
  } catch (err) {
    console.error(`[apply] could not mint status link for entry ${entryId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}


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

// Abuse containment for this PUBLIC, unauthenticated, side-effecting endpoint:
// each accepted POST spawns a Python profile build, writes a temp file, and can
// dispatch a candidate email. The body/field caps above stop one fat request;
// this stops a flood of small ones. Per (job, client) fixed window — generous
// for a human filling the conversational form, hostile to a script. Mirrors the
// inbound-channel route. (clientIpFrom's XFF caveat is documented in rate-limit.ts.)
const APPLY_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

// Record the renewed interest on the applicant's ORIGINAL entry and return the
// "already applied" acknowledgment. Shared by BOTH dedup paths — the primary
// name-based check and the dedupeKey backstop race — so the event name and
// duplicate flag can never drift between them. The localized `message` (shown to
// the candidate) is passed in by the caller from the request's "apply" catalog.
// W8-6 (APP1): `changes` lists what the merge folded onto the original entry
// (contact backfill, profile rebuild); it lands in the event detail so the feed
// shows WHAT a repeat contributed, not just that one happened.
// E2 — `enriched` marks the repeat that REBUILT the profile (the quick-apply
// lead following its enrichment link, or any degraded stub recovered). The
// client celebrates it as a completed profile rather than shrugging "already
// applied" at a candidate who just did exactly what we asked them to.
function acknowledgeReapply(entryId: string, message: string, changes: string[] = [], enriched = false, workspaceId?: string): NextResponse {
  const detail = changes.length
    ? `repeat application via conversational apply — ${changes.join("; ")}`
    : "repeat application via conversational apply";
  recordAutomationEvent(entryId, "re_applied", detail, workspaceId);
  // The repeat reuses the ORIGINAL entry, so it returns the SAME status link
  // (getOrCreateStatusLink is keyed on entry_id) — a returning candidate can track.
  return NextResponse.json({ result: "accepted", duplicate: true, enriched, message, statusToken: safeStatusLink(entryId) });
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
    // Throttle BEFORE any DB read or Python spawn so a flood is rejected cheaply.
    if (!rateLimit(`apply:${id}:${clientIpFrom(request.headers)}`, APPLY_RATE_LIMIT)) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "Role not found." }, { status: 404 });
    // Tenant (P1): a public applicant has no session — file them into the OPENING's team
    // (a corpus job with no owner falls back to the default workspace).
    const workspaceId = getJobWorkspace(id);

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

    const body = (await request.json().catch(() => ({}))) as {
      answers?: Record<string, unknown>;
      // Lead-enrichment hand-off: the opaque token the apply page threaded
      // through from the ?lead= link. Untrusted — shape-gated and resolved below.
      lead?: unknown;
    };
    const answers = body.answers ?? {};

    // Knockout gate. Derive THIS job's KO steps from its own script (ko_mode/ko_lang are
    // conditional on workMode/languages) and require every expected KO answer to be present
    // AND explicitly true (failedKoStepIds — the shared, untrusted-boundary contract: an
    // ABSENT key is a fail, so a scripted POST can't skip eligibility by omitting keys).
    // E2 — the discard is AUDITED: an entry-less ko_declined event records who was turned
    // away from which role and on which gate, so the auto-discard never happens silently.
    const failedKo = failedKoStepIds(
      applyKoSteps(job, t).map((s) => s.id),
      answers
    );
    if (failedKo.length > 0) {
      recordKnockoutDecline({
        candidateLabel: String(answers.name ?? "").trim() || null,
        jobTitle: job.title,
        channel: "conversational apply",
        failedKoIds: failedKo,
      });
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
    const name = providedName || ANONYMOUS_APPLICANT_LABEL;
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
    // Optional GitHub handle (the `github` step) — shape-gated to a normalized
    // bare username at the trust boundary (the client validates the same gate
    // inline, so a null here is a scripted POST, not a candidate's typo). Junk
    // degrades to null: the handle is optional evidence, never a reason to
    // reject the application.
    const githubHandle = coerceGithubHandle(answers.github);

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
    if (email && !APPLY_EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    // Lead-enrichment hand-off: a valid token resolves DIRECTLY to the lead's
    // own entry, so the merge below targets it even when the typed email differs
    // from the one on file — re-typing the EXACT same address is no longer what
    // keeps one person on one pipeline row. Field-validated shape first
    // (coerceLeadTokenParam — never a cast), then the entry must belong to THIS
    // job; anything invalid/stale/mismatched degrades silently to the email/name
    // identity fallback below, never an error.
    const leadToken = coerceLeadTokenParam(body.lead);
    const leadTarget = leadToken ? findEntryByLeadToken(leadToken) : null;
    const leadEntry = leadTarget && leadTarget.entry.jobId === job.id ? leadTarget.entry : null;

    // The captured intake answers, assembled once from the parsed locals so the
    // re-apply rebuild and the first-apply build are guaranteed to feed
    // buildApplicantProfile the identical answer set (they differ only in whether
    // a target profile id is passed).
    const intakeAnswers: ApplyAnswers = {
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
    };

    // Duplicate-application policy (primary check): if this named applicant has
    // already applied to this role, surface the repeat on the original entry and
    // acknowledge it — don't create a second pipeline row. The lead token (when
    // valid) IS the identity; otherwise dedup keys on the EMAIL when given (the
    // stronger identity), else the name — so two same-named applicants with
    // different addresses no longer merge.
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
    if (leadEntry || providedName || email) {
      const existing = leadEntry ?? findApplicationByApplicant(job.id, providedName, email, workspaceId);
      if (existing) {
        const changes: string[] = [];
        const updates: { contact?: string; candidateId?: string; archetype?: string | null; githubHandle?: string } = {};
        let profileRebuilt = false;
        if (email && !existing.contact) {
          updates.contact = email;
          changes.push("contact email captured");
        }
        // A repeat (notably a lead's enrichment walk — the github step is new
        // to them) that shares a handle backfills a handle-less entry; one
        // already on file is kept (fill-only, see mergeReapplication).
        if (githubHandle && !existing.githubHandle) {
          updates.githubHandle = githubHandle;
          changes.push("GitHub handle captured");
        }
        if (cvText || existing.intakeDegraded) {
          const rebuilt = await buildApplicantProfile(job, intakeAnswers, existing.candidateId);
          if (rebuilt.ok) {
            updates.candidateId = rebuilt.id;
            updates.archetype = rebuilt.archetype;
            profileRebuilt = true;
            changes.push(
              existing.intakeDegraded ? "degraded intake recovered (profile rebuilt)" : "profile rebuilt with CV"
            );
          }
        }
        if (changes.length > 0) {
          const merged = mergeReapplication(existing.id, updates, workspaceId);
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
        // Re-applying re-consents: refresh the data-processing consent + expiry
        // (best-effort — a consent-record failure must never block the apply ack).
        try {
          recordEntryConsent(existing.id, "apply", undefined, workspaceId);
        } catch (consentErr) {
          console.error(`[apply] consent refresh failed for entry ${existing.id}:`, consentErr);
        }
        return acknowledgeReapply(
          existing.id,
          profileRebuilt ? t("enrichedMessage") : t("alreadyMessage"),
          changes,
          profileRebuilt,
          workspaceId
        );
      }
    }

    // Build a real, matchable V2 candidate from the answers; on failure fall back
    // to a label-only id AND flag the entry intake-degraded so the recruiter sees
    // a stub that needs manual profile capture (rather than a silent demotion).
    const built = await buildApplicantProfile(job, intakeAnswers);
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
      // Self-reported GitHub handle — the drawer's on-demand deep-dive hook.
      githubHandle,
      // SIM3 — the applicant's language, so downstream comms speak it.
      locale: applicantLocale,
      // E3 — inbound source attribution (the conversational careers-page flow).
      sourceChannel: "apply",
      workspaceId,
    });

    // GDPR: stamp data-processing consent + a 12-month expiry on the inbound entry
    // (the candidate agreed at submit, with the retention statement shown via
    // AiDisclosure). The expiry drives the anonymization sweep. Best-effort — never
    // block a successful application on the consent bookkeeping.
    try {
      recordEntryConsent(entry.id, "apply", undefined, workspaceId);
    } catch (consentErr) {
      console.error(`[apply] consent record failed for entry ${entry.id}:`, consentErr);
    }

    // created:false here means the dedupeKey backstop caught a concurrent repeat
    // submission — surface it as a re-apply rather than logging a second
    // "applied" against the same entry.
    if (!created) {
      return acknowledgeReapply(entry.id, t("alreadyMessage"), [], false, workspaceId);
    }

    // createPipelineEntry already logs an `intake_degraded` event for the stub; for
    // a healthy intake record the usual `applied` provenance. The event detail is
    // whichever lane's story the applicant told.
    if (built.ok) {
      const story = experience || studentProject || switchPrior;
      recordAutomationEvent(entry.id, "applied", story ? story.slice(0, 160) : "via conversational apply", workspaceId);
    }

    // Acknowledge the application (APP3) — a durable "we received it" instead of
    // only the in-page bubble. Best-effort: the entry is already created, so a
    // comms failure must never turn a successful application into a 500. Lands in
    // the Outbox (deliverable when an email was captured above, traceable either
    // way). Fires for degraded stubs too — they still applied.
    // Mint the status link ONCE so the ack email and the JSON response carry the
    // SAME token — the email is the durable touchpoint that survives the candidate
    // closing the tab (without it the unguessable token was lost forever on tab
    // close, defeating the whole status-tracking feature).
    const statusToken = safeStatusLink(entry.id);
    const statusLink = statusToken ? `${publicBaseUrl(new URL(request.url).origin)}/status/${statusToken}` : undefined;
    try {
      await dispatchApplicationReceived(entry, { statusLink });
    } catch (ackErr) {
      console.error(
        `[apply] application accepted but acknowledgement failed for entry ${entry.id}:`,
        ackErr instanceof Error ? ackErr.message : ackErr
      );
    }

    return NextResponse.json({
      result: "accepted",
      message: t("acceptedMessage"),
      // A tokenized link so the applicant can track their status (idea-e76a6fb2)
      // instead of going dark after applying.
      statusToken,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "apply failed" }, { status: 500 });
  }
}
