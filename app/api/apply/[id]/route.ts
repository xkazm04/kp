import { NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getServerLocale } from "@/i18n/server";
import { getJob, getJobWorkspace } from "@/app/_lib/db/jobs";
import { ensureLeadEnrichToken, findEntryByLeadToken, recordAutomationEvent, recordKnockoutDecline, setEntryProfileGaps, type EntryProfileGap } from "@/app/_lib/db/pipeline";
import { GAP_FIELDS } from "@/app/_lib/completeness-followup";
import { applyKoSteps } from "@/app/_lib/apply";
import { ANONYMOUS_APPLICANT_LABEL, APPLY_EMAIL_RE, coerceGithubHandle, coerceLeadTokenParam, failedKoStepIds, isHoneypotFilled } from "@/app/_lib/apply-intake";
import { getJobStatus, isJobOpenForApplications } from "@/app/_lib/job-ingest";
import { linkApplySession } from "@/app/_lib/apply-session-store";
import { isRelayConfigured } from "@/app/_lib/comms-relay";
import { recoverApplicationLinks, recoveryMessageKey } from "@/app/_lib/apply-link-recovery";
import { fileApplication, safeStatusToken } from "@/app/_lib/application-filing";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { afterResponse } from "@/app/_lib/after-response";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";
import { capAttribution } from "@/app/_lib/lead-payload";

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

// The "already applied" acknowledgment, shared by every duplicate outcome the
// filing core reports — the unproven match, the proven merge and the dedupeKey
// backstop race — so the response shape and duplicate flag can never drift between
// them. The localized `message` is passed in by the caller from the request's
// "apply" catalog. The `re_applied` event is NOT written here: it is part of the
// MUTATING half, so it lives in the core (application-filing.ts) behind the same
// proof the merge rides — an unproven repeat is a caller who typed a name we cannot
// authenticate, and letting it write a line into the recruiter's activity feed on
// the victim's timeline is both a nuisance channel and a false provenance record.
// E2 — `enriched` marks the repeat that REBUILT the profile (the quick-apply
// lead following its enrichment link, or any degraded stub recovered). The
// client celebrates it as a completed profile rather than shrugging "already
// applied" at a candidate who just did exactly what we asked them to.
function acknowledgeReapply(
  entryId: string,
  message: string,
  enriched: boolean,
  // The gap follow-up, when the repeat REBUILT the profile (an enrichment walk):
  // the freshly computed gaps are the honest ones to ask about.
  followup: FollowupOffer,
  // Did this caller PROVE they own the entry this response is about? See the
  // capability block below — the answer decides whether the entry's tokens are
  // allowed onto the wire at all.
  proven: boolean
): NextResponse {
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
  // path, unaffected), or the dedupeKey race where this very request created the
  // row. An ordinary re-application still gets its acknowledgement; the link
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
    ...(proven ? { statusToken: safeStatusToken(entryId), ...followup } : {}),
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
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
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
    if (!isJobOpenForApplications(getJobStatus(id, workspaceId))) {
      // Coded like every other refusal on this door. It used to answer the `apply`
      // catalog's own `roleClosed` sentence, localized SERVER-side from the request
      // — which reads correct and was not: the client resolves what it renders from
      // the CODE (applySubmitFailure -> useErrorMessage), so a bodied message with
      // no code fell straight through to the generic "something went wrong" in all
      // four languages. The page-level gate keeps using t("roleClosed"); this is the
      // API's half of the same fact.
      return jsonRefusal("APPLY_ROLE_CLOSED", 410);
    }

    // Reject an oversized body BEFORE buffering it into the heap. Content-Length used
    // to be the ONLY signal here — and it is attacker-controlled: omit it (chunked
    // transfer) or declare 10 while streaming 50 MB and the check waved the request
    // through to `request.json()`, which then buffered the lot. The per-field caps
    // below are a backstop on what gets STORED, never on what gets READ. The cap is
    // now measured on the bytes actually taken off the wire (request-body.ts), with
    // the header kept inside the helper as a cheap early-out for honest clients.
    const body = await readJsonWithLimit<{
      answers?: Record<string, unknown>;
      // Lead-enrichment hand-off: the opaque token the apply page threaded
      // through from the ?lead= link. Untrusted — shape-gated and resolved below.
      lead?: unknown;
      // The apply-funnel attempt this submission belongs to (apply-session-store.ts),
      // minted client-side when the candidate opened the form. Purely for
      // measurement — it grants nothing, so an absent or bogus value only leaves
      // the attempt looking abandoned.
      applySessionId?: unknown;
      company_url?: unknown;
      campaign?: unknown;
      variant?: unknown;
    }>(request, MAX_APPLY_BODY_BYTES, {});
    if (body === BODY_TOO_LARGE) return jsonRefusal("APPLY_PAYLOAD_TOO_LARGE", 413);
    // A filled hidden field signals an automated submission. Mirror the ordinary
    // knockout result without creating an entry or sending any comms.
    if (isHoneypotFilled(body)) {
      return NextResponse.json({ result: "declined", message: t("declinedMessage") });
    }
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

    // The ABSOLUTE origin every emailed link is built on.
    const base = publicBaseUrl(new URL(request.url).origin);

    // FILE THROUGH THE SHARED CORE (application-filing.ts). It owns the whole filing
    // contract for every door: the tenant (the opening's workspace, threaded into the
    // entry, the profile build, consent and every event — omitting it from the build
    // once saved the profile in the DEFAULT workspace while the entry went to the
    // opening's owner, so the recruiter found no profile, Match never saw the
    // candidate and the follow-up POST 404'd), identity BEFORE any profile is built,
    // the entry column, consent, the status-link mint and the acknowledgement.
    //
    // Duplicate-application policy: one application per (applicant, role). Identity
    // is the lead token when valid, else the EMAIL when given (the stronger identity),
    // else the provided name — so two same-named applicants with different addresses
    // do not merge, and the "Applicant" fallback is never a key (two anonymous
    // applicants must not be merged into one entry).
    //
    // What a match may do is this door's PROOF:
    //   - "token": a valid ?lead= token resolving to THIS entry — the emailed
    //     enrichment walk, the path the W8-6 merge ("merge, don't drop") was designed
    //     for and the only re-apply that is authenticated. It backfills a contactless
    //     entry's address (re-acking it, deferred, with the status link pinned to the
    //     language the EMAIL renders in), backfills the GitHub handle, and — for a
    //     CV-carrying repeat or a degraded stub — REBUILDS the profile. A FAILED
    //     rebuild touches nothing: a junk repeat can never degrade a healthy entry.
    //   - "none": everything else. The match came from a NAME (an email is optional
    //     and a bare name matches), and knowing that a person applied — a LinkedIn
    //     post is enough — must not make you their contact of record or overwrite the
    //     profile a recruiter scores. Not one column of the original entry moves, and
    //     no event or consent refresh is written (see the unproven branch below).
    const filed = await fileApplication({
      job,
      workspaceId,
      name: providedName,
      email: email || null,
      // SIM3 — the applicant's language, so downstream comms speak it.
      locale: applicantLocale,
      // E3 — inbound source attribution (the conversational careers-page flow).
      sourceChannel: "apply",
      sourceCampaign: typeof body.campaign === "string" ? capAttribution(body.campaign.trim()) || null : null,
      sourceVariant: typeof body.variant === "string" ? capAttribution(body.variant.trim()) || null : null,
      channelLabel: "conversational apply",
      // Self-reported GitHub handle — the drawer's on-demand deep-dive hook.
      githubHandle,
      answers: {
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
      ...(leadEntry ? { proof: "token" as const, tokenEntry: leadEntry } : { proof: "none" as const }),
      // The durable "where do I stand" link on every ack this door sends. Pinned to
      // the language the EMAIL renders in (the entry's own locale — the applied-in
      // one on a first filing): the link is opened outside the app, where no
      // NEXT_LOCALE cookie exists yet, and proxy.ts turns ?lang= back into it.
      statusLinkFor: (entry) => {
        const token = safeStatusToken(entry.id);
        return token ? `${base}/status/${token}?lang=${entry.locale || applicantLocale}` : null;
      },
      // Both acks — the first one and the newly-reachable re-ack — run AFTER this
      // response: an SMTP/relay round-trip whose failure already cannot change the
      // outcome only made a slow provider look like a broken apply form.
      defer: (task, kind) => afterResponse(kind === "reack" ? "apply-reack" : "apply-ack", task),
      // The audit prose this door has always written: WHAT a repeat contributed.
      repeatDetail: (changes) =>
        changes.length
          ? `repeat application via conversational apply — ${changes.join("; ")}`
          : "repeat application via conversational apply",
    });

    // Close the funnel loop on whichever path reached the pipeline: a first
    // application, the dedupe backstop, a merge, or an unproven repeat (the last
    // writes to apply_sessions, keyed by the caller's OWN attempt id — never to the
    // entry — and the attempt genuinely did reach a filed application).
    linkApplySession(applySessionId, filed.entry.id);

    if (filed.kind === "duplicate") {
      if (!filed.merged) {
        // UNPROVEN: the candidate is told they already applied (they must be —
        // silently dropping a repeat is how the "update my info" path became
        // invisible), and the promise that they are not stranded is kept: the
        // entry's OWN status + enrichment links go to the address ON FILE (never the
        // one this request typed), at most once per entry per 24h, with no event
        // and no consent write. The copy is picked from the relay state alone, so
        // the answer is the same whether or not an address is on file
        // (apply-link-recovery.ts).
        const relayConfigured = isRelayConfigured();
        recoverApplicationLinks(filed.entry, {
          base,
          relayConfigured,
          defer: (task) => afterResponse("apply-link-recovery", task),
        });
        return acknowledgeReapply(filed.entry.id, t(recoveryMessageKey(relayConfigured)), false, {}, false);
      }
      // PROVEN — the lead token, or the dedupeKey backstop race. The race is
      // unreachable by identity-guessing: it needs the dedupeKey to COLLIDE while the
      // identity lookup MISSED, and the two read the same (email, else name)
      // identity — so what arrives there is the genuine double-submit (a retry whose
      // first response was lost), which must keep its status link: with no relay
      // configured the on-screen link is the candidate's only touchpoint.
      const rebuilt = filed.rebuilt?.ok ? filed.rebuilt : null;
      // The gap follow-up offered on THIS response, populated only by a rebuild.
      const followup = rebuilt ? recordAndOfferGaps(filed.entry.id, rebuilt.missingGaps, workspaceId) : {};
      return acknowledgeReapply(filed.entry.id, rebuilt ? t("enrichedMessage") : t("alreadyMessage"), rebuilt !== null, followup, true);
    }

    const { entry, built } = filed;
    // createPipelineEntry already logs an `intake_degraded` event for the stub; for
    // a healthy intake record the usual `applied` provenance. The event detail is
    // whichever lane's story the applicant told.
    if (built?.ok) {
      const story = experience || studentProject || switchPrior;
      recordAutomationEvent(entry.id, "applied", story ? story.slice(0, 160) : "via conversational apply", workspaceId);
    }

    // The core already minted this entry's status link (synchronously, before it
    // scheduled the acknowledgement); getOrCreateStatusLink is keyed on the entry,
    // so this is the SAME token the ack email carries — the email is the durable
    // touchpoint that survives the candidate closing the tab.
    const statusToken = safeStatusToken(entry.id);

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
      ...(built?.ok ? recordAndOfferGaps(entry.id, built.missingGaps, workspaceId) : {}),
    });
  } catch (error) {
    // Public + unauthenticated: a raw err.message here is SQLite/Python/fs
    // internals on the wire. Log it server-side, answer generically (same
    // contract the sibling /api/status token route already follows).
    return safeJsonError(error, "api:apply", "APPLY_FAILED");
  }
}
