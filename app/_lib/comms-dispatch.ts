import { sendComm, type OutboundMessage } from "./comms";
import { recordOutbox, type OutboxEntry } from "./db/devcase";
import { isSimTitle } from "@/app/features/shell/simulation/constants";
import type { OutboxStatus } from "./comms-status";
import type { PipelineEntry } from "./db/core";
import { ensureErasureToken, entryProfileGaps, recordAutomationEvent } from "./db/pipeline";
import { buildRejectionFeedback, renderRejectionFeedback } from "./rejection-feedback";
import { outreachHaltFor, recordOutreachSend } from "./outreach-state-store";
import type { HaltReason } from "./outreach-halt";
import { isEarlyCareer } from "./archetypes";
import { candidateOutreachSuppression } from "./rediscovery-alert-store";
import { extractDeliverableAddress, extractRecipientName } from "./comms-recipient";
import { buildIcs } from "./export-utils";
import { publicBaseUrl, publicOriginIsFallback } from "./public-base-url.ts";
import { resolveCommsLocale } from "./comms-locale";
import { commsTranslator, type CommsTranslator } from "./comms-translator";
import { namespaceTranslator } from "./catalog-translator";
import type { Locale } from "@/i18n/locales";
import { pinLinkLocale } from "./candidate-link-locale";
import { INTERVIEW_TZ } from "./schedule-slots";
import { DEFAULT_INTERVIEW_MINUTES } from "./calendar/constants";
import { dateFormatter } from "./date-format.ts";

// Direction #3 — real comms delivery for the hiring pipeline. Routes recruiter
// automation through the shared sendComm channel (durable local outbox by
// default, a real relay when COMMS_WEBHOOK_URL is set) so outreach and
// rejections actually reach the candidate — and land in the same Outbox audit
// log as the dev lifecycle's comms. Mirrors the inline-template pattern already
// used by distribution.ts (intake ack) and devcase-orchestrator.ts (invite).
//
// SIM3 — every template renders in the CANDIDATE'S language. The deterministic
// bodies moved into the `comms.*` namespace of every messages/<locale>.json and render
// through a locale-pinned translator built from the entry's stored `locale`
// (captured at apply; NULL ⇒ the entry's OWN team default — 'cs' for the ČS seed — via
// candidateLocale/comms-locale.resolveCommsLocale, so the 60/65 legacy NULL-locale entries stop
// receiving English letters under the bank's brand; pa-l2-null-locale). The
// LLM-authored bodies (outreach, the offer letter) are generated in the SAME
// resolved locale (automation-run passes it to the Python letter tasks), and
// their deterministic chrome (fallback subject, the offer's terms + response
// footers) localizes here.

// The locale-pinned `comms` translator lives in comms-translator.ts —
// devcase-feedback.ts needed the same cache, and two copies of "how to load a
// catalog outside a request" is one too many.

// RECIPIENT CONTRACT (full write-up in docs/features/comms/README.md). Resolved in
// priority:
//   1. contact        — a real address captured at inbound apply (idea APP2). When
//      present this is a directly-deliverable recipient, not just an identifier —
//      it closes the "unaddressable recipient" seam for applicants.
//   2. candidateLabel — the human display name (the historical case; an ATS/relay
//      maps name → address via its own directory).
//   3. candidateId    — a stable opaque id when no label exists.
//   4. "candidate"    — last-resort literal. UNADDRESSABLE: a relay cannot deliver
//      to it, so the message will dead-letter. `ref` (the entry id) on every
//      OutboundMessage keeps even this case traceable in the Outbox audit log.
// Recruiter/Match-sourced entries still carry no contact, so they resolve to the
// name as before — the enrichment is purely additive for inbound applicants.
export function candidateRecipient(entry: {
  candidateLabel?: string | null;
  candidateId?: string | null;
  contact?: string | null;
}): string {
  return (entry.contact ?? "").trim() || (entry.candidateLabel ?? "").trim() || (entry.candidateId ?? "").trim() || "candidate";
}

// The display name interpolated into every greeting; the catalog supplies the
// localized "there" fallback so an anonymous applicant isn't greeted in English.
function greetName(entry: { candidateLabel?: string | null }, t: CommsTranslator): string {
  return (entry.candidateLabel ?? "").trim() || t("there");
}

// The language a candidate hears from us in, resolved against THEIR team.
//
// `commsTranslator` re-resolves whatever locale it is handed, but it cannot know the
// tenant: with no workspace, a NULL-locale entry falls back to the DEFAULT team's
// `default_locale`. That was documented in comms-locale.ts as latent-only "because
// PipelineEntry does not carry workspaceId" — it does now (db/core.ts surfaces it), so
// every dispatcher passes the entry's own team here and the entry-less ones pass the
// tenant their caller holds. Without it, a NULL-locale candidate filed into a second
// team whose Settings → Organization language is `de` was written to in the DEFAULT
// team's language (`cs` on the ČS seed). Resolving here is idempotent: the returned
// Locale passes `isLocale`, so the translator's own resolution returns it verbatim.
function candidateLocale(locale: string | null | undefined, workspaceId?: string | null): Locale {
  return resolveCommsLocale(locale, workspaceId ?? undefined);
}

// The one link-builder for candidate-facing URLs BUILT INSIDE this module (the
// GDPR data footer). Links a candidate opens from an email must be ABSOLUTE — a
// relative "/data/er-…" path is dead in every mail
// client (capst-l2-102) — so this resolves through the same publicBaseUrl
// precedence the status/offer/schedule links use. Dispatches almost always run
// inside a request (apply ack, reject, offer, invite), so the runtime origin is
// recovered from the ambient request headers — the exact origin the ABSOLUTE
// status link beside the footer was built from. Detached callers (heartbeat
// sweeps, offer-lapse reminders) have no request, so they need APP_BASE_URL /
// NEXT_PUBLIC_APP_BASE_URL set; when nothing resolves, warn loudly instead of
// silently shipping a dead link (the footer still renders — never silently drop
// a legal affordance).
async function candidateLinkBase(): Promise<string> {
  let origin: string | null = null;
  try {
    // next/headers is request-scoped: inside a route handler it yields the real
    // request headers; in a detached sweep it throws and we fall through to the
    // configured override. Imported lazily so loading this module never depends
    // on a Next request context (unit tests, scripts).
    const { headers } = await import("next/headers");
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
      origin = `${proto}://${host.split(",")[0].trim()}`;
    }
  } catch {
    /* no ambient request (scheduler/heartbeat) — rely on the env override */
  }
  const base = publicBaseUrl(origin);
  // publicBaseUrl now always returns an absolute origin (it falls back to the canonical
  // site default rather than the old ""), so a candidate link is never a dead relative
  // path. But a fallback means nothing deployment-specific was configured — the link uses
  // the DEFAULT origin, which may be wrong for this deploy — so still warn loudly.
  if (publicOriginIsFallback(origin)) {
    console.warn(
      "[comms] no public origin configured — candidate links use the default site origin, which may be wrong for this deploy. Set APP_BASE_URL (or NEXT_PUBLIC_APP_BASE_URL) for detached sends."
    );
  }
  return base;
}

// GDPR self-service footer appended to every candidate-facing comm: a localized
// "review or erase your data" line carrying the entry's opaque erasure token
// (minted fill-only here) → the public /data/[token] page. Skipped for an
// already-anonymized entry (nothing left to manage) or one we can't mint a token
// for. The link is ABSOLUTE via candidateLinkBase() — the request origin when
// dispatched from a route handler, the configured override otherwise (same
// resolution as the status link that rides beside it).
// The minimal candidate shape the footer + recipient resolution need — looser than
// PipelineEntry so the lighter interview reminder/invite callers (which may carry
// no entry id) can use the same wrapper.
type CandidateCommTarget = {
  id?: string | null;
  // The SIM guard's input: a `(SIM)`-marked title means this comm is a demo
  // artifact and must never be handed to a real relay (see sendCommUnlessSim).
  // Optional only because two callers pass a structural subtype — both of those
  // carry a jobTitle of their own.
  jobTitle?: string | null;
  candidateLabel?: string | null;
  candidateId?: string | null;
  contact?: string | null;
  anonymizedAt?: string | null;
  // The entry's own team. Optional because two callers pass a structural subtype
  // assembled from an invite/session rather than a PipelineEntry; they supply the
  // tenant through their own `opts.workspaceId` instead.
  workspaceId?: string | null;
};

async function dataFooter(entry: CandidateCommTarget, t: CommsTranslator, locale: Locale): Promise<string> {
  if (entry.anonymizedAt || !entry.id) return ""; // already scrubbed, or no entry to manage
  const token = ensureErasureToken(entry.id, entry.workspaceId ?? undefined);
  if (!token) return "";
  // ?lang= pins the page to the language the LETTER is written in, exactly as the status
  // link that rides beside it does (proxy.ts turns the param into the NEXT_LOCALE cookie).
  // Unpinned, the page resolved from a cookie the candidate does not have and then from
  // Accept-Language — so a cs-locale candidate reading on an English-configured browser
  // opened the erasure explainer (a legal affordance) in a language they never chose,
  // while the other link in the same letter opened in Czech.
  const link = `${await candidateLinkBase()}/data/${encodeURIComponent(token)}?lang=${locale}`;
  return "\n\n" + t("dataFooter", { link });
}

// --- The SIMULATION guard ------------------------------------------------------
//
// The guided tour (app/features/shell/simulation) seeds candidates and then drives
// the REAL invite/offer paths — the demo's whole claim is that nothing is faked. So
// with a relay configured (COMMS_WEBHOOK_URL or the UI-configured one), a demo run
// POSTed a schedule invite and an offer letter about a SEEDED profile to the
// customer's real mail relay. Nothing in this module knew the marker existed.
//
// THE FIELD: `jobTitle` on the pipeline entry the comm is about — the one the sim
// writer stamps (simCvIntakeTarget / markSimTitle), resetSim purges by and the
// analytics read-side filter excludes. Same predicate as all three (`isSimTitle`),
// so a marker change moves the writer, the purge, the filters AND this guard at once.
// Entry-less dispatches pass the title they hold (a KO decline's `input.jobTitle`).
//
// WHAT IT DOES: records the row — the demo's Outbox entry is half of what the tour
// shows, and dropping it silently would be its own lie — but writes it directly to
// the local outbox on the `simulation` channel instead of handing it to the channel
// resolver, so no relay is ever contacted for a simulated candidate.
//
// STATUS: `queued`, the outbox's honest "recorded locally, nothing will deliver it"
// terminal state (comms-status.ts). It is NOT `sent`: a simulated letter reached
// nobody. There is no `skipped` member in OUTBOX_STATUSES — adding one would touch
// the enum, the db column contract and every UI that styles by it — so the CHANNEL
// carries the reason and the status stays truthful.
export const SIM_COMMS_CHANNEL = "simulation";

async function sendCommUnlessSim(msg: OutboundMessage, jobTitle: string | null | undefined): Promise<OutboxEntry> {
  if (!isSimTitle(jobTitle)) return sendComm(msg);
  return recordOutbox({
    recipient: msg.to,
    subject: msg.subject,
    body: msg.body,
    kind: msg.kind,
    channel: SIM_COMMS_CHANNEL,
    status: "queued",
    ref: msg.ref,
    workspaceId: msg.workspaceId,
  });
}

// Candidate-facing send: identical to sendComm but auto-appends the GDPR data
// footer and defaults `to`/`ref` from the entry, so every applicant comm carries
// the self-service erasure link without each dispatcher re-deriving it.
// Returns the recorded outbox row's REAL delivery status (queued / sent /
// failed — see comms-status.ts): callers that surface a claim must key their
// language off this (REC-10), never off "the call resolved" — with no relay
// configured a resolved send is a terminal `queued` row nothing will deliver.
async function sendCandidateComm(
  entry: CandidateCommTarget,
  t: CommsTranslator,
  msg: { subject: string; body: string; kind: string; ref?: string; workspaceId?: string | null },
  // The language the letter is written in — carried so the footer's own link is pinned to
  // it. Passed rather than re-derived: `t` cannot report the locale it was built for.
  locale: Locale
): Promise<OutboxStatus> {
  const recorded = await sendCommUnlessSim({
    to: candidateRecipient(entry),
    subject: msg.subject,
    body: msg.body + (await dataFooter(entry, t, locale)),
    kind: msg.kind,
    ref: msg.ref ?? entry.id ?? undefined,
    // Fallback tenant for the case where `ref` names no pipeline entry (a slot/link
    // ref on an entry-less dispatch). Ignored whenever the entry resolves.
    workspaceId: msg.workspaceId,
  }, entry.jobTitle);
  return recorded.status;
}

/** Acknowledge a freshly-received inbound application. Inbound applicants got only
 *  an ephemeral in-page "You're in 🎉" bubble — no durable acknowledgement, even
 *  though dev-case submissions auto-ack and every other pipeline event fires a
 *  comm. Brings applicants to comms parity: a candidate who closes the tab still
 *  has a record their application landed. Deterministic (works without an LLM) and
 *  goes through the shared sendComm Outbox channel — the audit row is useful even
 *  before a real address is captured, and deliverable once one is (APP2).
 *
 *  E2/E4 (Erika gap) — `opts.enrichLink`: a quick-apply lead lands as a thin,
 *  non-matchable stub, so its ack carries the ABSOLUTE link to the full
 *  conversational apply (resolved via publicBaseUrl by the caller — the candidate
 *  opens it outside the app). Re-applying with the same address is the enrichment
 *  path: the merge machinery rebuilds the profile onto the original entry. The
 *  speed-to-lead point is that this invitation goes out the moment the lead lands,
 *  not when a recruiter gets around to the stub.
 *
 *  CATALOG: composed from the SAME `comms.ack.*` keys distribution.ts's intake ack
 *  uses (greeting ▸ body ▸ signoff, with the -Role variants when the opening is
 *  known). It used to render `ack.subject` with a `{role}` that key never had, and
 *  `ack.bodyEnrich` / `ack.statusLine`, which exist in NO locale — next-intl returns
 *  the key PATH for a missing message, so a quick-apply lead's acknowledgement email
 *  literally read "comms.ack.bodyEnrich". The two link lines are labelled from the
 *  `apply` namespace: those are the very calls-to-action the quick-apply page shows
 *  beside the same two links, so the mail and the page say the same thing in all
 *  four locales, and an unlabelled bare URL never ships. */
export async function dispatchApplicationReceived(
  entry: PipelineEntry,
  opts?: { enrichLink?: string; statusLink?: string }
): Promise<void> {
  const locale = candidateLocale(entry.locale, entry.workspaceId);
  const t = await commsTranslator(locale);
  const ta = await namespaceTranslator(locale, "apply");
  const role = (entry.jobTitle ?? "").trim();
  const name = greetName(entry, t);
  const subject = role ? t("ack.subjectRole", { role }) : t("ack.subject");
  const lines = [t("ack.greeting", { name }), "", role ? t("ack.bodyRole", { role }) : t("ack.body")];
  // The enrichment invitation (a quick-apply stub) and the durable status link — the
  // touchpoint that lets the candidate check where they stand after the tab is gone.
  if (opts?.enrichLink) lines.push("", `${ta("quick.enrichCta")} — ${ta("quick.enrichNote")}`, opts.enrichLink);
  if (opts?.statusLink) lines.push("", `${ta("trackStatus")}:`, opts.statusLink);
  lines.push("", t("ack.signoff"));
  await sendCandidateComm(entry, t, { subject, body: lines.join("\n"), kind: "acknowledgement" }, locale);
  recordAutomationEvent(entry.id, "acknowledgement_sent", role, entry.workspaceId);
}

/** Outcome of an outreach dispatch: delivered, or SUPPRESSED for a consent reason
 *  (so the caller/UI shows "cannot contact" rather than a false "reached out"). */
// `replied`/`manual` join the consent reasons (W2.3): every way a send can be refused
// is one union, so a caller cannot handle the compliance refusals and silently miss the
// sequence-stopped ones.
export type OutreachResult = { sent: true } | { sent: false; reason: "anonymized" | "consent_expired" | HaltReason };

/** Dispatch an outreach message — the LLM/deterministic draft just generated.
 *  The body is the model's; only the fallback subject (used when the draft has
 *  none) localizes.
 *
 *  COMPLIANCE GATE (CAN-SPAM/GDPR): outreach — especially via rediscovery, which
 *  re-contacts previously-REJECTED candidates — must never send to a candidate whose
 *  processing consent has EXPIRED or who has been ANONYMIZED. Consult the consent
 *  state BEFORE sending; on suppression, return the reason and record NOTHING (no
 *  outreach_sent marker), so a later re-consent can still be contacted. The consent
 *  system governed retention/anonymization but was never consulted on the outbound
 *  path — this closes that gap.
 *
 *  Consent is resolved at the durable CANDIDATE identity, not this one entry:
 *  rediscovery mints a fresh per-role entry with BLANK consent, so an entry-only
 *  read would happily re-contact a person whose ORIGINAL consent expired or who was
 *  anonymized/erased (bug-ui-scan #1). The entry's own snapshot is folded in so an
 *  entry that carries no candidateId keeps the exact entry-level guarantee; the
 *  gate FAILS CLOSED on an unreadable consent state. */
export async function dispatchOutreach(
  entry: PipelineEntry,
  draft: { subject?: unknown; body?: unknown }
): Promise<OutreachResult> {
  const suppress = candidateOutreachSuppression(entry.candidateId, {
    givenAt: entry.consentGivenAt,
    expiresAt: entry.consentExpiresAt,
    anonymizedAt: entry.anonymizedAt,
  });
  if (suppress) {
    // Audit the refusal so the absence of a send is visible, not silent.
    recordAutomationEvent(entry.id, "outreach_suppressed", suppress, entry.workspaceId);
    return { sent: false, reason: suppress };
  }
  // W2.3 — the sequence stops once the person answers it (or a recruiter stops it by
  // hand). Checked AFTER consent so the irreversible gate stays first, and audited the
  // same way: a send that did not happen must be visible in the log.
  const halt = outreachHaltFor(entry.id, entry.workspaceId);
  if (halt) {
    recordAutomationEvent(entry.id, "outreach_suppressed", halt, entry.workspaceId);
    return { sent: false, reason: halt };
  }
  const locale = candidateLocale(entry.locale, entry.workspaceId);
  const t = await commsTranslator(locale);
  const role = entry.jobTitle ?? t("aRole");
  const subject = String(draft.subject ?? t("outreach.subjectFallback", { role })).trim();
  const body = String(draft.body ?? "").trim();
  await sendCandidateComm(entry, t, { subject, body, kind: "outreach" }, locale);
  // Recorded only after the send actually happened — counting an attempt would make a
  // failed send look like a contact, and `sends > 0` is what later distinguishes a reply
  // from a fresh application.
  recordOutreachSend(entry.id, entry.workspaceId);
  recordAutomationEvent(entry.id, "outreach_sent", entry.jobTitle ?? "", entry.workspaceId);
  return { sent: true };
}

/**
 * Dispatch a rejection on a (human or policy) reject decision. Deterministic,
 * respectful template — no LLM, so it works in a batch policy pass and never
 * ghosts a rejected candidate. Early-career archetypes get an encouraging line,
 * keeping the fairness lever consistent through to the adverse comm.
 *
 * W0.6 — when the record holds a REASON (the recruiter's own still-unmet checklist
 * items), the letter now says it. Sourced from what was recorded, never generated: a
 * fresh LLM call here would be slow in a batch pass and would invent a rationale that
 * was never the actual reason. Protected-attribute lines are dropped whole, and with
 * nothing recorded the template ships exactly as before (rejection-feedback.ts).
 */
export async function dispatchRejection(entry: PipelineEntry, opts?: { automated?: boolean }): Promise<void> {
  const locale = candidateLocale(entry.locale, entry.workspaceId);
  const t = await commsTranslator(locale);
  const name = greetName(entry, t);
  const role = entry.jobTitle ?? t("theRole");
  const middle = isEarlyCareer(entry.archetype) ? t("rejection.early") : t("rejection.standard");

  // Workspace resolution matches every sibling dispatcher in this module (they all let
  // recordAutomationEvent take the default): PipelineEntry carries no workspaceId, and a
  // lone deviation here would read as a tenancy fix while being a guess.
  const feedback = buildRejectionFeedback({ profileGaps: entryProfileGaps(entry.id, entry.workspaceId) });
  const feedbackBlock = renderRejectionFeedback(feedback, t("rejection.feedbackIntro"), t("rejection.feedbackOutro"));

  const subject = t("rejection.subject", { role });
  const body = t("rejection.opening", { name, role }) + middle + feedbackBlock + t("rejection.closing", { team: t("team") });

  await sendCandidateComm(entry, t, { subject, body, kind: "rejection" }, locale);
  recordAutomationEvent(
    entry.id,
    "rejection_sent",
    // The detail records whether the candidate got a reason and where it came from, so
    // the decision log can answer "was this rejection explained?" without reopening the
    // outbox body. `filtered` is recorded too — a dropped line is a fairness event.
    [
      opts?.automated ? "policy auto-reject" : "manual reject",
      `feedback:${feedback.source}`,
      feedback.filtered ? "protected-filter:fired" : null,
    ]
      .filter(Boolean)
      .join(" · "),
    entry.workspaceId
  );
}

/** Tell a KO-declined lead the outcome — entry-less by design. Channel leads are
 *  declined BEFORE any pipeline entry exists (lead-intake's knockout gate), so the
 *  one identity in hand is the inbound email; `ref` is omitted and the envelope
 *  ships null context (comms-envelope handles a missing entry). The own quick-apply
 *  form shows the decline live in the UI — this comm is for webhook surfaces whose
 *  candidate saw "submitted" on a third-party board and would otherwise hear
 *  nothing, ever.
 *
 *  TENANT (comms-tenancy-pair): with no entry there is nothing for recordOutbox to
 *  derive a workspace from, so the row used to land in the DEFAULT team's Comms
 *  Center — for a non-default team, in a board its recruiters cannot see, while the
 *  decline itself was correctly recorded (recordKnockoutDecline) in their own. The
 *  caller holds the authoritative tenant (the webhook's / the opening's team) and
 *  passes it here, so the notice and the decline record file together. */
export async function dispatchKnockoutDecline(input: {
  email: string;
  name?: string | null;
  jobTitle?: string | null;
  locale?: string | null;
  /** The team that owns the declined lead. Omitted ⇒ the default workspace. */
  workspaceId?: string | null;
}): Promise<void> {
  const locale = candidateLocale(input.locale, input.workspaceId);
  const t = await commsTranslator(locale);
  const name = (input.name ?? "").trim() || t("there");
  const role = input.jobTitle ?? t("theRole");
  const subject = t("koDecline.subject", { role });
  const body = t("koDecline.body", { name, role, team: t("team") });
  await sendCommUnlessSim({ to: input.email, subject, body, kind: "ko_decline", workspaceId: input.workspaceId }, input.jobTitle);
}

/**
 * Deliver the (recruiter-approved) offer to the candidate with a token-gated
 * accept/decline link. The offer DECISION stays human — this fires only after a
 * recruiter extends the drafted offer. Appends the response link to the letter.
 * The letter body is the model's; the fallback subject, the deterministic offer
 * TERMS (deadline + start date) and the response footer localize here.
 *
 * OO-L1-04 — the terms are injected at DISPATCH, not draft: the deadline is a
 * per-offer lever the recruiter sets at approval time (ttlDays → offers.expires_at),
 * so the letter draft cannot know it. Appending the offer row's actual deadline
 * (and the start date when one is known) deterministically guarantees EVERY sent
 * letter states them — LLM-drafted and deterministic-template letters alike —
 * and can never contradict the countdown on the candidate's offer page.
 */
export async function dispatchOffer(
  entry: PipelineEntry,
  draft: { subject?: unknown; body?: unknown },
  responseLink: string,
  opts?: { expiresAt?: string | null; startDate?: string | null }
): Promise<void> {
  const locale = candidateLocale(entry.locale, entry.workspaceId);
  const t = await commsTranslator(locale);
  const subject = String(draft.subject ?? t("offer.subjectFallback", { role: entry.jobTitle ?? t("aRole") })).trim();
  const letter = String(draft.body ?? "").trim();
  const terms: string[] = [];
  const deadline = formatOfferDeadline(opts?.expiresAt ?? null, entry.locale, entry.workspaceId);
  if (deadline) terms.push(t("offer.deadlineLine", { deadline }));
  const startDate = (opts?.startDate ?? "").trim();
  if (startDate) terms.push(t("offer.startLine", { date: startDate }));
  const termsBlock = terms.length > 0 ? `${terms.join("\n")}\n\n` : "";
  // The response link is pinned to the LETTER's locale here, beside the resolution
  // above, so the page it opens speaks the language the letter was written in — the
  // status, erasure and schedule links already do; the offer link was the one bare
  // door (perfect: offer-door-speaks-the-letter-language, 2026-09-01).
  const link = pinLinkLocale(responseLink, locale);
  const body = `${letter}\n\n` + termsBlock + t("offer.responseFooter", { link });
  await sendCandidateComm(entry, t, { subject, body, kind: "offer" }, locale);
  recordAutomationEvent(entry.id, "offer_sent", entry.jobTitle ?? "", entry.workspaceId);
}

/** Confirm a candidate's self-booked interview slot. For a normal booking this
 *  promises a separate reminder before the call. For a *short-notice* booking
 *  (`opts.shortNotice`, decided by interview-reminder-policy.ts) no timed reminder
 *  will fire — the slot is too close — so the wording drops that promise and the
 *  confirmation reads as the candidate's "see you soon" heads-up instead. Keeping
 *  the copy honest is the point: we never tell someone a reminder is coming and
 *  then silently skip it. */
export async function dispatchInterviewConfirmation(
  entry: PipelineEntry,
  slot: string,
  opts?: {
    shortNotice?: boolean;
    durationMin?: number | null;
    rescheduleLink?: string | null;
    // The absolute instant + the candidate's captured zone. When both are absent the
    // letter falls back to the stored English `slot` label, which is what it always
    // used — so this is additive for any caller that does not yet thread them.
    slotAtIso?: string | null;
    candidateTz?: string | null;
  }
): Promise<OutboxStatus> {
  const locale = candidateLocale(entry.locale, entry.workspaceId);
  const t = await commsTranslator(locale);
  const name = greetName(entry, t);
  const role = entry.jobTitle ?? t("theRole");
  // The one fact this letter exists to carry, in the candidate's language and zone.
  const slotText = formatSlotForLetter(opts?.slotAtIso, locale, opts?.candidateTz) || slot;
  // Tell the candidate how long to block: a student's scripted screen runs ~22
  // minutes, and "booked for Tue 10:00" alone reads like a quick call.
  const length = opts?.durationMin ? t("interviewConfirmation.length", { minutes: opts.durationMin }) : "";
  const subject = t("interviewConfirmation.subject", { role });
  const body = opts?.shortNotice
    ? t("interviewConfirmation.short", { name, role, slot: slotText, length, team: t("team") })
    : t("interviewConfirmation.normal", { name, role, slot: slotText, length, team: t("team") });
  // The confirmation is the candidate's only durable artifact — once the tab
  // closes, this footer link is the one way back to reschedule (SCH2) or grab
  // the .ics. ABSOLUTE, resolved via publicBaseUrl by the caller.
  const footer = opts?.rescheduleLink ? `\n\n${t("interviewConfirmation.linkFooter", { link: opts.rescheduleLink })}` : "";
  const status = await sendCandidateComm(entry, t, { subject, body: body + footer, kind: "interview_confirmation" }, locale);
  recordAutomationEvent(entry.id, "interview_scheduled", slot, entry.workspaceId);
  return status;
}

/** Brief the assigned interviewer (PREP5) when a candidate books their slot. The
 *  interviewer used to receive nothing — no prep, no calendar hold, no reminder —
 *  even though buildIcs and the comms channel already existed; the only sharing
 *  path was the recruiter manually copy-pasting the prep clipboard dump out of
 *  band. The interviewer field is free-text, so we accept `Name <email>` (or a
 *  bare address) and email the brief + an inline .ics hold ONLY when it carries a
 *  deliverable address; an assigned-but-nameless/emailless interviewer records
 *  `interviewer_brief_skipped` so the recruiter sees the brief did not go (the
 *  addressability signal, mirroring the candidate side). The brief renders in the
 *  locale the prep pack was generated in (the recruiter's), since the interviewer
 *  is org-side staff, not the candidate. Returns whether a brief was dispatched. */
export async function dispatchInterviewerBrief(
  entry: PipelineEntry,
  slot: string,
  opts: {
    interviewer: string | null | undefined;
    durationMin?: number | null;
    slotAtIso?: string | null;
    scenario?: string | null;
    focusAreas?: string[] | null;
    lang?: string | null;
  }
): Promise<boolean> {
  const assigned = (opts.interviewer ?? "").trim();
  const address = extractDeliverableAddress(assigned);
  if (!address) {
    // Assigned but unaddressable (a bare name), or unassigned — surface the gap so
    // the prep pack doesn't silently never reach the person running the round.
    if (entry.id && assigned) recordAutomationEvent(entry.id, "interviewer_brief_skipped", assigned, entry.workspaceId);
    return false;
  }
  const locale = candidateLocale(opts.lang, entry.workspaceId);
  const t = await commsTranslator(locale);
  const name = extractRecipientName(assigned) ?? t("there");
  const role = entry.jobTitle ?? t("theRole");
  const candidate = (entry.candidateLabel ?? "").trim() || t("there");
  const length = opts.durationMin ? t("interviewerBrief.length", { minutes: opts.durationMin }) : "";
  const focus = (opts.focusAreas ?? []).filter((f) => f && f.trim()).join(", ") || t("interviewerBrief.focusFallback");
  const scenario = opts.scenario?.trim() || t("interviewerBrief.scenarioFallback");
  const subject = t("interviewerBrief.subject", { candidate, role });
  // The interviewer is org-side staff, so the brief states the slot in the INTERVIEW
  // zone (not a candidate's) — but it still names that zone, in the recruiter's
  // language, instead of shipping the bare English label.
  const slotText = formatSlotForLetter(opts.slotAtIso, locale) || slot;
  let body = t("interviewerBrief.body", { name, candidate, role, slot: slotText, length, scenario, focus });

  // Inline .ics calendar hold — the candidate gets one client-side; the interviewer
  // got none. Built only when we know the absolute slot start. The outbox is a
  // plain-text channel, so it rides inline under a header, saveable as an .ics.
  if (opts.slotAtIso) {
    try {
      const ics = buildIcs({
        uid: `kp-interview-${entry.id ?? "x"}-${assigned.replace(/[^a-zA-Z0-9]+/g, "-")}`,
        start: opts.slotAtIso,
        // The ONE default interview length (calendar/constants.ts). This inlined 30
        // while the candidate's own .ics and the free/busy window used 45, so the
        // interviewer's calendar hold was quietly 15 minutes shorter than the call.
        durationMin: opts.durationMin && opts.durationMin > 0 ? opts.durationMin : DEFAULT_INTERVIEW_MINUTES,
        title: t("interviewerBrief.icsTitle", { candidate, role }),
        description: scenario,
      });
      body += `\n\n${t("interviewerBrief.calendarHeader")}\n${ics}`;
    } catch {
      /* unparseable slot — skip the hold; the brief itself still delivers */
    }
  }

  // The interviewer is org-side staff, but a brief about a SEEDED candidate is still
  // demo traffic — same guard, same marker (the entry's own role title).
  await sendCommUnlessSim({ to: address, subject, body, kind: "interviewer_brief", ref: entry.id ?? undefined }, entry.jobTitle);
  if (entry.id) recordAutomationEvent(entry.id, "interviewer_brief_sent", name, entry.workspaceId);
  return true;
}

/** Deliver the freshly-minted self-scheduling link TO the candidate. The voice
 *  screen (interview_invite) and the offer both auto-dispatch their token links;
 *  the scheduling link was the one candidate token that never shipped — the
 *  recruiter had to paste it into a channel outside the app, with no Outbox row
 *  to distinguish a delivered invite from a forgotten one. Takes the full entry
 *  so the recipient contract sees `contact` (deliverable for inbound applicants).
 *  `link` must be ABSOLUTE (resolved via publicBaseUrl by the caller). Records a
 *  schedule_invite_sent event. */
export async function dispatchScheduleInvite(
  entry: PipelineEntry,
  link: string,
  opts?: { durationMin?: number | null }
): Promise<OutboxStatus> {
  const locale = candidateLocale(entry.locale, entry.workspaceId);
  const t = await commsTranslator(locale);
  const name = greetName(entry, t);
  const role = entry.jobTitle ?? t("theRole");
  const length = opts?.durationMin ? t("scheduleInvite.length", { minutes: opts.durationMin }) : "";
  const subject = t("scheduleInvite.subject", { role });
  const body = t("scheduleInvite.body", { name, role, link, length, team: t("team") });
  const status = await sendCandidateComm(entry, t, { subject, body, kind: "schedule_invite" }, locale);
  recordAutomationEvent(entry.id, "schedule_invite_sent", role, entry.workspaceId);
  return status;
}

/** Reminder fired by the scheduler heartbeat before a confirmed interview.
 *
 *  Delivery boundary matters here: the heartbeat retries a *throw* from this call,
 *  so a throw must mean "the message did NOT go out." The channel handoff (sendComm)
 *  is the only step that may throw — if it resolves, the candidate has been reminded.
 *  The audit write that follows is post-send bookkeeping; were it allowed to throw
 *  (e.g. a transient SQLite contention after the message already left), the caller
 *  would re-arm and send the candidate a DUPLICATE reminder. So it is logged and
 *  swallowed, never surfaced as a delivery failure.
 *
 *  TENANT (comms-tenancy-pair): this is the one reminder whose `ref` can fail to name
 *  a pipeline entry — the sweep reminds an invite whose linked entry has since been
 *  deleted (dueReminders LEFT JOINs and keeps a null entry eligible), and then `ref`
 *  degrades to the human-readable slot string, which resolves to nothing. The invite
 *  row carries the owning team, so the caller passes it as the fallback tenant. */
export async function dispatchInterviewReminder(
  entry: { id?: string | null; candidateLabel?: string | null; candidateId?: string | null; jobTitle?: string | null; locale?: string | null },
  // NULLABLE: the sweep used to substitute the English string "your scheduled time"
  // for a row with no stored label and interpolate it into a Czech/German/French
  // letter. The fallback is a catalog key now, so the caller passes what it has.
  slot: string | null,
  opts?: { durationMin?: number | null; workspaceId?: string | null; slotAtIso?: string | null; candidateTz?: string | null }
): Promise<void> {
  const locale = candidateLocale(entry.locale, opts?.workspaceId);
  const t = await commsTranslator(locale);
  const name = greetName(entry, t);
  const role = entry.jobTitle ?? t("theRole");
  const length = opts?.durationMin ? t("interviewReminder.length", { minutes: opts.durationMin }) : "";
  // Same rule as the confirmation: the instant in the candidate's own zone, with the
  // zone named; the stored English label only if there is no instant to format.
  const slotText = formatSlotForLetter(opts?.slotAtIso, locale, opts?.candidateTz) || slot || t("interviewReminder.slotFallback");
  const subject = t("interviewReminder.subject", { slot: slotText });
  const body = t("interviewReminder.body", { name, role, slot: slotText, length, team: t("team") });
  await sendCandidateComm(entry, t, {
    subject,
    body,
    kind: "interview_reminder",
    ref: entry.id ?? slot ?? "interview",
    workspaceId: opts?.workspaceId,
  }, locale);
  // Post-send: the reminder is delivered. Do not let an audit-log failure re-throw —
  // that would look like a delivery failure and trigger a duplicate send.
  try {
    // Same fallback tenant the send above uses: this entry is a structural subtype
    // (the sweep can hand us a reminder whose linked entry is gone), so the invite
    // row's own team is the authority, not a field on `entry`.
    // The ledger is RECRUITER-side: it keeps the stored, operator-stable label, not
    // the candidate-localized letter text (which differs per reader).
    if (entry.id) recordAutomationEvent(entry.id, "interview_reminder_sent", slot ?? "", opts?.workspaceId ?? undefined);
  } catch (e) {
    console.error(`[reminder] delivered but audit-log write failed for entry ${entry.id}: ${e instanceof Error ? e.message : e}`);
  }
}

/** Deliver the freshly-minted voice-screen link TO the candidate. Without this the
 *  link only ever opened in the recruiter's own browser tab — the headline voice
 *  feature was undeliverable end-to-end. Routes through the same sendComm channel
 *  as every other candidate comm (durable local Outbox by default, a real relay
 *  only when COMMS_WEBHOOK_URL is set), so it lands in the Outbox audit log and
 *  dead-letters traceably if the recipient identifier can't be resolved. Records an
 *  interview_invite_sent event. `link` must be ABSOLUTE — the candidate opens it
 *  outside the app — so callers resolve it through publicBaseUrl. */
export async function dispatchInterviewInvite(
  entry: { id?: string | null; candidateLabel?: string | null; candidateId?: string | null; jobTitle?: string | null; locale?: string | null },
  link: string,
  // `workspaceId` mirrors dispatchInterviewReminder: this entry is a structural
  // subtype, so the caller supplies the tenant for the outbox row and the audit
  // event. Without it both landed on the default team.
  opts?: { durationMin?: number | null; workspaceId?: string | null }
): Promise<OutboxStatus> {
  const locale = candidateLocale(entry.locale, opts?.workspaceId);
  const t = await commsTranslator(locale);
  const name = greetName(entry, t);
  const role = entry.jobTitle ?? t("theRole");
  const length = opts?.durationMin ? t("interviewInvite.length", { minutes: opts.durationMin }) : "";
  const subject = t("interviewInvite.subject", { role });
  const body = t("interviewInvite.body", { name, role, link, length, team: t("team") });
  const status = await sendCandidateComm(entry, t, {
    subject,
    body,
    kind: "interview_invite",
    ref: entry.id ?? link,
    workspaceId: opts?.workspaceId,
  }, locale);
  if (entry.id) recordAutomationEvent(entry.id, "interview_invite_sent", role, opts?.workspaceId ?? undefined);
  return status;
}

/** Format an offer's ISO deadline for the candidate's locale, or "" if absent/invalid
 *  (offers in the reminder window always carry one; the guard keeps the body clean). */
/** The slot line a LETTER states, formatted from the absolute `slot_at` in the
 *  reader's own zone and language — never the stored `slot` label.
 *
 *  That label (schedule-slots.slotLabel) is minted from hardcoded English DOW/MON
 *  arrays in the INTERVIEWER's zone and carries no zone marker. It is the right
 *  string for the picker chips and the recruiter agenda, and the wrong one for mail:
 *  it was the ONLY thing the localized confirmation and reminder templates
 *  interpolated, so a Czech candidate in Prague received a Czech letter whose one
 *  load-bearing fact read "Tue 9 Jun · 10:00" — English inside Czech prose, in a zone
 *  the letter never named, while the candidate's OWN zone had been captured at confirm
 *  (schedule_invites.candidate_tz) and never used outbound.
 *
 *  `tz` is candidate-supplied (Intl.DateTimeFormat().resolvedOptions().timeZone from
 *  their browser), so an unknown or malformed zone makes Intl THROW — it falls back to
 *  the interview zone rather than costing the candidate their confirmation. Returns ""
 *  when there is no usable instant, so callers keep the legacy label as the fallback.
 *  Same component spelling as formatOfferDeadline: dateStyle/timeStyle may not be
 *  combined with timeZoneName, so every part is named. */
export function formatSlotForLetter(
  slotAtIso: string | null | undefined,
  locale: Locale,
  tz?: string | null
): string {
  if (!slotAtIso) return "";
  const ms = Date.parse(slotAtIso);
  if (Number.isNaN(ms)) return "";
  const parts = {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  } as const;
  const zone = (tz ?? "").trim() || INTERVIEW_TZ;
  try {
    return new Intl.DateTimeFormat(locale, { ...parts, timeZone: zone }).format(new Date(ms));
  } catch {
    // A zone string the runtime does not know (a stale browser, a hand-edited row).
    // The interview zone is always valid, and a letter with the wrong-but-named zone
    // beats no letter at all.
    try {
      return new Intl.DateTimeFormat(locale, { ...parts, timeZone: INTERVIEW_TZ }).format(new Date(ms));
    } catch {
      return ""; // even the configured interview zone is unusable — keep the stored label
    }
  }
}

function formatOfferDeadline(iso: string | null, locale: string | null | undefined, workspaceId?: string | null): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const loc = candidateLocale(locale, workspaceId);
  // The deadline NAMES ITS TIMEZONE. Offer expiry is elapsed time, not wall clock
  // (offer-policy.offerExpiresAtMs states why), so a window crossing a DST boundary
  // lands an hour off the local time it was minted at — and a bare "29 Mar, 15:00"
  // in a letter read in another country is ambiguous besides. `timeStyle: "short"`
  // cannot carry a zone, so the parts are spelled out: same date + time as before,
  // plus the short zone name of whatever clock the server is on, in the candidate's
  // own language.
  // (dateStyle/timeStyle may not be combined with individual component options —
  // Intl THROWS on the mix — so every part is spelled out explicitly.)
  // Memoized: the sweep writes this line for every open offer in the reminder
  // window, and a fresh Intl.DateTimeFormat per letter was the most expensive thing
  // in an otherwise trivial function (date-format.ts).
  return dateFormatter(loc, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(ms));
}

/** The proactive expiry nudge (idea-29361408 follow-up): a single heads-up fired by
 *  the heartbeat as an open offer nears its T-48h deadline, so a candidate who simply
 *  forgot doesn't lose a live offer to silence. `link` is the candidate's existing
 *  offer page (ABSOLUTE, resolved via publicBaseUrl by the caller).
 *
 *  Delivery boundary mirrors dispatchInterviewReminder: a throw means the message did
 *  NOT go out. (The sweep already CAS-claimed reminded_at, so a throw here is logged,
 *  not retried — at-most-once.) The post-send audit write is swallowed so a transient
 *  DB blip after the message left can't masquerade as a delivery failure. */
export async function dispatchOfferReminder(entry: PipelineEntry, link: string, deadlineIso: string | null): Promise<void> {
  const locale = candidateLocale(entry.locale, entry.workspaceId);
  const t = await commsTranslator(locale);
  const name = greetName(entry, t);
  const role = entry.jobTitle ?? t("theRole");
  const deadline = formatOfferDeadline(deadlineIso, entry.locale, entry.workspaceId);
  const subject = t("offerReminder.subject", { role });
  // Same pin as dispatchOffer: the nudge must open the same-language page the letter did.
  const pinned = pinLinkLocale(link, locale);
  const body = t("offerReminder.body", { name, role, deadline, link: pinned, team: t("team") });
  await sendCandidateComm(entry, t, { subject, body, kind: "offer_reminder", ref: entry.id ?? link }, locale);
  try {
    recordAutomationEvent(entry.id, "offer_reminder_sent", role, entry.workspaceId);
  } catch (e) {
    console.error(`[offer-reminder] delivered but audit-log write failed for entry ${entry.id}: ${e instanceof Error ? e.message : e}`);
  }
}
