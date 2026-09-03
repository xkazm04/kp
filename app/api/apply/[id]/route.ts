import { NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getServerLocale } from "@/i18n/server";
import { getJob, getJobWorkspace } from "@/app/_lib/db/jobs";
import { createPipelineEntry, ensureLeadEnrichToken, findApplicationByApplicant, findEntryByLeadToken, mergeReapplication, recordAutomationEvent, recordEntryConsent, recordKnockoutDecline, setEntryProfileGaps, type EntryProfileGap } from "@/app/_lib/db/pipeline";
import { GAP_FIELDS } from "@/app/_lib/completeness-followup";
import { applyDedupeKey, applyKoSteps, FALLBACK_ARCHETYPE } from "@/app/_lib/apply";
import { ANONYMOUS_APPLICANT_LABEL, APPLY_EMAIL_RE, coerceGithubHandle, coerceLeadTokenParam, failedKoStepIds } from "@/app/_lib/apply-intake";
import { getJobStatus, isJobOpenForApplications } from "@/app/_lib/job-ingest";
import { getPipelineAxis } from "@/app/_lib/pipeline-axis-server";
import { stageWithRole } from "@/app/_lib/pipeline-stages";
import { linkApplySession } from "@/app/_lib/apply-session-store";
import { dispatchApplicationReceived } from "@/app/_lib/comms-dispatch";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import type { ApplyAnswers } from "@/app/_lib/apply-intake";
import { buildApplicantProfile } from "@/app/_lib/applicant-profile";
import { randomId } from "@/app/_lib/random-id";
import { getOrCreateStatusLink } from "@/app/_lib/application-status-store";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { afterResponse } from "@/app/_lib/after-response";

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


// How many of the profile's unmet-checklist gaps the candidate is offered right
// after "You're in". Deliberately small: this is a courtesy ask on a flow that has
// ALREADY succeeded, not a second form. The rest stay recorded on the entry.
const MAX_FOLLOWUP_QUESTIONS = 3;

/** The optional post-accept gap follow-up offered to the candidate. Absent
 *  entirely when there's nothing askable — the client then renders the plain
 *  done screen it always has. */
type FollowupOffer = { followupToken: string; followupGaps: EntryProfileGap[] } | Record<string, never>;

// Record the profile build's unmet gaps on the entry and, when any of them is a
// question we actually know how to ask, mint the capability the candidate answers
// under. The token is the EXISTING lead-enrichment token (ensureLeadEnrichToken —
// CSPRNG, opaque, already meaning "this candidate may enrich this entry"), never
// the raw entry id. Wholly best-effort: the application is already filed, so a
// failure here silently degrades to "no follow-up offered".
function recordAndOfferGaps(entryId: string, gaps: EntryProfileGap[], workspaceId: string): FollowupOffer {
  try {
    setEntryProfileGaps(entryId, gaps, workspaceId);
  } catch (err) {
    console.error(`[apply] could not record profile gaps for entry ${entryId}:`, err instanceof Error ? err.message : err);
  }
  // Only gaps this build knows a localized question for — an unknown/new
  // checklist id stays RECORDED (the recruiter still sees it) but is never
  // rendered as a label with no input.
  const askable = gaps.filter((g) => GAP_FIELDS[g.check]).slice(0, MAX_FOLLOWUP_QUESTIONS);
  if (askable.length === 0) return {};
  try {
    const token = ensureLeadEnrichToken(entryId, undefined, workspaceId);
    return token ? { followupToken: token, followupGaps: askable } : {};
  } catch (err) {
    console.error(`[apply] could not mint follow-up token for entry ${entryId}:`, err instanceof Error ? err.message : err);
    return {};
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
function acknowledgeReapply(
  entryId: string,
  message: string,
  changes: string[] = [],
  enriched = false,
  workspaceId?: string,
  // The gap follow-up, when the repeat REBUILT the profile (an enrichment walk):
  // the freshly computed gaps are the honest ones to ask about.
  followup: FollowupOffer = {},
  // Did this caller PROVE they own the entry this response is about? See the
  // capability block below — the answer decides whether the entry's tokens are
  // allowed onto the wire at all.
  proven = false
): NextResponse {
  const detail = changes.length
    ? `repeat application via conversational apply — ${changes.join("; ")}`
    : "repeat application via conversational apply";
  recordAutomationEvent(entryId, "re_applied", detail, workspaceId);
  // CAPABILITY GATE — the reason this response is thinner than the first-apply one.
  //
  // A duplicate is detected from the submitted NAME/EMAIL alone
  // (findApplicationByApplicant), and neither is a secret: anyone may POST
  // `{name: "<a real applicant>", ko_*: true}` — the email is optional, a bare
  // name matches — and the route would answer 200 with THAT person's status token
  // and (on a rebuild) their lead-enrichment token. Those are capabilities, not
  // identifiers: the status token opens /status/<token>, which carries their live
  // stage and their EU AI-Act decision history (including an auto-reject's
  // score-vs-threshold), and the lead token opens /apply/<job>?lead=<token>, which
  // prefills their name and email and authorizes the follow-up POST. The
  // status-link store's whole premise is that the token is "the only public handle,
  // so a candidate can check their own status without anyone being able to
  // enumerate others'" — handing it to whoever guessed a name broke exactly that.
  //
  // So the tokens ride ONLY when the caller demonstrated possession of this entry:
  // a valid ?lead= capability token (the emailed enrichment walk — the designed
  // path, unaffected), or the dedupeKey race below where this very request created
  // the row. An ordinary re-application still gets its acknowledgement; the link
  // reaches its owner through the address on file, which is the one channel we can
  // authenticate. The `duplicate` flag itself stays: the candidate must be told
  // honestly that they already applied.
  return NextResponse.json({
    result: "accepted",
    duplicate: true,
    enriched,
    message,
    // The repeat reuses the ORIGINAL entry, so a proven caller gets the SAME status
    // link (getOrCreateStatusLink is keyed on entry_id) — the returning lead can track.
    ...(proven ? { statusToken: safeStatusLink(entryId), ...followup } : {}),
  });
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
      // Shared codeless 429 envelope (rate-limit-contract.test.ts pins it).
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const job = getJob(id);
    if (!job) return jsonRefusal("APPLY_ROLE_NOT_FOUND", 404);
    // Tenant (P1): a public applicant has no session — file them into the OPENING's team
    // (a corpus job with no owner falls back to the default workspace).
    const workspaceId = getJobWorkspace(id);

    // Candidate-facing outcome messages (returned in the JSON and shown verbatim
    // in the chat) are localized from the request's "apply" catalog.
    const t = await getTranslations("apply");
    // SIM3 — the language the candidate applied in, persisted on the entry so
    // every downstream comm (ack/rejection/interview/offer) renders
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
      return jsonRefusal("APPLY_PAYLOAD_TOO_LARGE", 413);
    }

    const body = (await request.json().catch(() => ({}))) as {
      answers?: Record<string, unknown>;
      // Lead-enrichment hand-off: the opaque token the apply page threaded
      // through from the ?lead= link. Untrusted — shape-gated and resolved below.
      lead?: unknown;
      // The apply-funnel attempt this submission belongs to (apply-session-store.ts),
      // minted client-side when the candidate opened the form. Purely for
      // measurement — it grants nothing, so an absent or bogus value only leaves
      // the attempt looking abandoned.
      applySessionId?: unknown;
    };
    const answers = body.answers ?? {};
    // Close the funnel loop on whichever path files an entry: a first application,
    // the dedupe backstop, or a re-apply that merged onto the original. All three
    // mean the attempt reached the pipeline, which is what the rate measures.
    const applySessionId = typeof body.applySessionId === "string" ? body.applySessionId : null;

    // The provided name drives the duplicate-application policy; the "Applicant"
    // fallback is a display label only. We never dedup on the fallback — two
    // anonymous applicants must not be merged into one entry — so the dedup key
    // is derived from `providedName` (blank ⇒ no dedup).
    const providedName = String(answers.name ?? "").trim();
    const name = providedName || ANONYMOUS_APPLICANT_LABEL;
    // Capped HERE, above the knockout gate, and not with the other field caps
    // below: a KO decline PERSISTS this label on its audit event
    // (recordKnockoutDecline → pipeline_events.candidate_label, which bounds the
    // detail but NOT the label) and then returns. With the check downstream, a
    // declined POST could write a body-sized name straight into the recruiter's
    // activity feed while never reaching the cap. The quick-apply route already
    // validates before its KO verdict; this keeps the two surfaces aligned.
    if (name.length > MAX_NAME_LENGTH) {
      // The refusal names the OFFENDING STEP (`field`) and its cap (`max`) as
      // data: the door re-asks that one question with the typed answer still in
      // the box instead of restarting an 8-step chat. See apply-submit-outcome.ts.
      return jsonRefusal("APPLY_NAME_TOO_LONG", 400, { field: "name", max: MAX_NAME_LENGTH });
    }

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
        candidateLabel: providedName || null,
        jobTitle: job.title,
        channel: "conversational apply",
        failedKoIds: failedKo,
        // The opening's team — the decline belongs to whoever owns the role, not
        // to the default workspace (see recordKnockoutDecline).
        workspaceId,
      });
      return NextResponse.json({
        result: "declined",
        message: t("declinedMessage"),
      });
    }

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
    // (The name cap runs earlier, above the knockout gate — see the note there.)
    // Keyed by STEP ID, not positional: the refusal has to name which answer was
    // rejected so the door can re-ask that step (the ids are buildApplyScript's).
    const freeText: [string, string][] = [
      ["experience", experience],
      ["skills", skills],
      ["student_project", studentProject],
      ["student_education", studentEducation],
      ["student_aspirations", studentAspirations],
      ["switch_prior", switchPrior],
      ["switch_aspirations", switchAspirations],
    ];
    const overlong = freeText.find(([, value]) => value.length > MAX_TEXT_LENGTH);
    if (overlong) {
      return jsonRefusal("APPLY_ANSWER_TOO_LONG", 400, { field: overlong[0], max: MAX_TEXT_LENGTH });
    }
    if (archetype.length > MAX_ARCHETYPE_LENGTH) {
      return jsonRefusal("APPLY_SELECTION_INVALID", 400, { field: "archetype" });
    }
    // Apply doesn't HARD-block on a missing email (the entry still files; comms
    // just stay undeliverable until a contact is captured) — but a clearly
    // malformed address is rejected so the stored recipient is never junk.
    // This leniency is for SCRIPTED/webhook callers only; the conversational UI
    // requires the address. See the decision comment on the `email` step in
    // app/_lib/apply.ts — that step owns the contract.
    if (email.length > MAX_EMAIL_LENGTH) {
      return jsonRefusal("APPLY_EMAIL_TOO_LONG", 400, { field: "email", max: MAX_EMAIL_LENGTH });
    }
    if (email && !APPLY_EMAIL_RE.test(email)) {
      return jsonRefusal("APPLY_EMAIL_INVALID", 400, { field: "email" });
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
        // The gap follow-up offered on THIS response, populated only by a rebuild.
        let followup: FollowupOffer = {};
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
          // Same tenant the entry itself is filed into (see the first-apply build
          // below): the rebuilt profile must land in the team that owns the opening.
          const rebuilt = await buildApplicantProfile(job, intakeAnswers, existing.candidateId, workspaceId);
          if (rebuilt.ok) {
            updates.candidateId = rebuilt.id;
            updates.archetype = rebuilt.archetype;
            profileRebuilt = true;
            followup = recordAndOfferGaps(existing.id, rebuilt.missingGaps, workspaceId);
            changes.push(
              existing.intakeDegraded ? "degraded intake recovered (profile rebuilt)" : "profile rebuilt with CV"
            );
          }
        }
        if (changes.length > 0) {
          const merged = mergeReapplication(existing.id, updates, workspaceId);
          // Newly reachable: the original acknowledgment dead-lettered (no
          // recipient existed), so send it to the address just captured.
          // Best-effort, same contract as the first-apply ack below — and, like
          // it, dispatched AFTER this response rather than in front of it.
          if (updates.contact && merged) {
            // …carrying the status link, exactly like the first-apply ack and the
            // quick-apply ack (capst-l1-002). This is the ONE ack that reaches a
            // candidate whose entry had no address until now, so without the link
            // they are the only applicant we never hand a durable way to check
            // where they stand — and since a name/email-matched repeat no longer
            // gets the token in its JSON response (see acknowledgeReapply's
            // capability gate), this email is the whole delivery path. Minted
            // synchronously, before the deferral, so the token is the entry's real
            // one; pinned to the language the EMAIL renders in (the entry's own
            // locale, which is what dispatchApplicationReceived resolves), not the
            // language of whoever POSTed.
            const reackToken = safeStatusLink(merged.id);
            const reackLink = reackToken
              ? `${publicBaseUrl(new URL(request.url).origin)}/status/${reackToken}?lang=${merged.locale || applicantLocale}`
              : undefined;
            afterResponse("apply-reack", async () => {
              try {
                await dispatchApplicationReceived(merged, reackLink ? { statusLink: reackLink } : undefined);
              } catch (ackErr) {
                console.error(
                  `[apply] re-apply merged but acknowledgement failed for entry ${merged.id}:`,
                  ackErr instanceof Error ? ackErr.message : ackErr
                );
              }
            });
          }
        }
        // Re-applying re-consents: refresh the data-processing consent + expiry
        // (best-effort — a consent-record failure must never block the apply ack).
        try {
          recordEntryConsent(existing.id, "apply", undefined, workspaceId);
        } catch (consentErr) {
          console.error(`[apply] consent refresh failed for entry ${existing.id}:`, consentErr);
        }
        linkApplySession(applySessionId, existing.id);
        return acknowledgeReapply(
          existing.id,
          profileRebuilt ? t("enrichedMessage") : t("alreadyMessage"),
          changes,
          profileRebuilt,
          workspaceId,
          followup,
          // Proof of ownership is the ?lead= capability token resolving to THIS
          // entry — the emailed enrichment walk. A name/email match is not proof
          // (see the capability gate in acknowledgeReapply).
          leadEntry !== null
        );
      }
    }

    // Build a real, matchable V2 candidate from the answers; on failure fall back
    // to a label-only id AND flag the entry intake-degraded so the recruiter sees
    // a stub that needs manual profile capture (rather than a silent demotion).
    //
    // Tenant (P1): the profile row MUST be filed into the same team the entry below
    // is stamped with (buildApplicantProfile takes it as a caller argument — it is
    // not derivable from `job`). Omitting it saved the profile in the DEFAULT
    // workspace while the entry went to the opening's owner, so for any job owned by
    // a non-default team the recruiter opened their new applicant and found no
    // profile behind them, the Match pool never saw the candidate, and the follow-up
    // POST below 404'd (it reads getProfileRecord(profileId, getJobWorkspace(job.id))).
    const built = await buildApplicantProfile(job, intakeAnswers, null, workspaceId);
    const candidateId = built.ok ? built.id : randomId("apply");

    const { entry, created } = createPipelineEntry({
      candidateId,
      candidateLabel: name,
      // A degraded intake (or a build with no archetype) is stamped UNCLASSIFIED —
      // never a guessed archetype, and never a concrete class that would strip the
      // fail-closed fairness shield. See FALLBACK_ARCHETYPE.
      archetype: (built.ok ? built.archetype : null) ?? FALLBACK_ARCHETYPE,
      roleFamily: job.roleFamily ?? null,
      jobId: job.id,
      jobTitle: job.title,
      // A fresh application arrives at the board's ENTRY column, whatever THIS
      // workspace calls it — not at a stage that happens to be named "Accepted".
      // The axis is editable, so a hardcoded name stranded every conversational
      // applicant on the off-axis strip (PipelineBoardOffAxisStrip) the moment a
      // team renamed or removed its first column, while quick-apply leads
      // (lead-intake.ts) and CV intake (cv-intake.ts) landed correctly.
      stage: stageWithRole("entry", getPipelineAxis(workspaceId).stages) ?? "Accepted",
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

    linkApplySession(applySessionId, entry.id);

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
    //
    // `proven`: this branch is unreachable by identity-guessing. Getting here needs
    // the dedupeKey to COLLIDE while findApplicationByApplicant above MISSED, and
    // the two read the same (email, else name) identity — an impostor who supplies
    // a real applicant's address or name is matched by the check above and never
    // arrives here. What does arrive is the genuine double-submit (a retry whose
    // first response was lost), which must keep its status link: with no relay
    // configured the on-screen link is the candidate's only touchpoint.
    if (!created) {
      return acknowledgeReapply(entry.id, t("alreadyMessage"), [], false, workspaceId, {}, true);
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
    // The dispatch itself runs AFTER this response: it's an SMTP/relay round-trip
    // whose failure already can't change the outcome, so awaiting it only made a
    // slow provider look like a slow (or broken) apply form for an application
    // that had already succeeded. The token is minted BEFORE, synchronously, so
    // the response and the email still carry the same one.
    const statusToken = safeStatusLink(entry.id);
    // Pinned to the language the candidate applied in — this ABSOLUTE link is
    // opened from an email, outside the app, where no NEXT_LOCALE cookie exists
    // yet; without ?lang= a Czech applicant lands on an English status page.
    // Same convention (and the same proxy.ts handler) as the enrichment link.
    const statusLink = statusToken
      ? `${publicBaseUrl(new URL(request.url).origin)}/status/${statusToken}?lang=${applicantLocale}`
      : undefined;
    afterResponse("apply-ack", async () => {
      try {
        await dispatchApplicationReceived(entry, { statusLink });
      } catch (ackErr) {
        console.error(
          `[apply] application accepted but acknowledgement failed for entry ${entry.id}:`,
          ackErr instanceof Error ? ackErr.message : ackErr
        );
      }
    });

    return NextResponse.json({
      result: "accepted",
      message: t("acceptedMessage"),
      // A tokenized link so the applicant can track their status (idea-e76a6fb2)
      // instead of going dark after applying.
      statusToken,
      // The OPTIONAL post-accept gap questions. profile_cli already computed which
      // checklist items this profile still misses on every build; until now the
      // list was discarded, so the only person who can answer them — the candidate,
      // standing right here — was never asked. Purely additive to the response:
      // absent when there is nothing askable, and the client treats it as an
      // after-the-fact courtesy (the application is already filed).
      ...(built.ok ? recordAndOfferGaps(entry.id, built.missingGaps, workspaceId) : {}),
    });
  } catch (error) {
    // Public + unauthenticated: a raw err.message here is SQLite/Python/fs
    // internals on the wire. Log it server-side, answer generically (same
    // contract the sibling /api/status token route already follows).
    return safeJsonError(error, "api:apply", "APPLY_FAILED");
  }
}
