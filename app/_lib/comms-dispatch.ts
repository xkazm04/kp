import { createTranslator } from "next-intl";
import { sendComm } from "./comms";
import { ensureErasureToken, recordAutomationEvent, type PipelineEntry } from "./db";
import { isEarlyCareer } from "./archetypes";
import { outreachSuppressionReason } from "./consent";
import { extractDeliverableAddress, extractRecipientName } from "./comms-recipient";
import { buildIcs } from "./export-utils";
import { publicBaseUrl } from "./public-base-url";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";

// Direction #3 — real comms delivery for the hiring pipeline. Routes recruiter
// automation through the shared sendComm channel (durable local outbox by
// default, a real relay when COMMS_WEBHOOK_URL is set) so outreach and
// rejections actually reach the candidate — and land in the same Outbox audit
// log as the dev lifecycle's comms. Mirrors the inline-template pattern already
// used by distribution.ts (intake ack) and devcase-orchestrator.ts (invite).
//
// SIM3 — every template renders in the CANDIDATE'S language. The deterministic
// bodies moved into the `comms.*` namespace of messages/{en,cs}.json and render
// through a locale-pinned translator built from the entry's stored `locale`
// (captured at apply; NULL ⇒ "en" for recruiter/Match-sourced entries). The
// LLM-authored bodies (outreach, the offer letter) stay as the model produced
// them — only their deterministic chrome (fallback subject, the offer's
// response-link footer) localizes.

// One cached translator per locale: createTranslator is the non-request core
// API, so it needs the messages handed in — loaded once per locale via the same
// relative-path dynamic import the request config uses (so the bundler can
// statically enumerate the catalogs). Synchronous after the first load.
//
// The catalogs load as `Record<string, unknown>`, so next-intl's compile-time
// key checking can't see the `comms.*` keys and types every key as `never`.
// This module is the one place that loads messages dynamically, so we narrow
// the translator to a plain `(key, values) => string` callable — the catalog is
// instead pinned by comms-dispatch.test.ts, which renders every key.
type CommsTranslator = (key: string, values?: Record<string, string | number>) => string;
const translatorByLocale = new Map<string, CommsTranslator>();

async function commsTranslator(locale: string | null | undefined): Promise<CommsTranslator> {
  const loc = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const cached = translatorByLocale.get(loc);
  if (cached) return cached;
  const messages = (await import(`../../messages/${loc}.json`)).default as Record<string, unknown>;
  const t = createTranslator({ locale: loc, messages, namespace: "comms" }) as unknown as CommsTranslator;
  translatorByLocale.set(loc, t);
  return t;
}

// RECIPIENT CONTRACT (full write-up in docs/COMMS_DELIVERY.md). Resolved in
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

// GDPR self-service footer appended to every candidate-facing comm: a localized
// "review or erase your data" line carrying the entry's opaque erasure token
// (minted fill-only here) → the public /data/[token] page. Skipped for an
// already-anonymized entry (nothing left to manage) or one we can't mint a token
// for. publicBaseUrl() resolves the configured public origin (these run detached,
// with no request origin — same as the offer-lapse / reminder links).
// The minimal candidate shape the footer + recipient resolution need — looser than
// PipelineEntry so the lighter interview reminder/invite callers (which may carry
// no entry id) can use the same wrapper.
type CandidateCommTarget = {
  id?: string | null;
  candidateLabel?: string | null;
  candidateId?: string | null;
  contact?: string | null;
  anonymizedAt?: string | null;
};

function dataFooter(entry: CandidateCommTarget, t: CommsTranslator): string {
  if (entry.anonymizedAt || !entry.id) return ""; // already scrubbed, or no entry to manage
  const token = ensureErasureToken(entry.id);
  if (!token) return "";
  return "\n\n" + t("dataFooter", { link: `${publicBaseUrl()}/data/${encodeURIComponent(token)}` });
}

// Candidate-facing send: identical to sendComm but auto-appends the GDPR data
// footer and defaults `to`/`ref` from the entry, so every applicant comm carries
// the self-service erasure link without each dispatcher re-deriving it.
async function sendCandidateComm(
  entry: CandidateCommTarget,
  t: CommsTranslator,
  msg: { subject: string; body: string; kind: string; ref?: string }
): Promise<void> {
  await sendComm({
    to: candidateRecipient(entry),
    subject: msg.subject,
    body: msg.body + dataFooter(entry, t),
    kind: msg.kind,
    ref: msg.ref ?? entry.id ?? undefined,
  });
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
 *  not when a recruiter gets around to the stub. */
export async function dispatchApplicationReceived(
  entry: PipelineEntry,
  opts?: { enrichLink?: string; statusLink?: string }
): Promise<void> {
  const t = await commsTranslator(entry.locale);
  const role = entry.jobTitle ?? t("theRole");
  const name = greetName(entry, t);
  const subject = t("ack.subject", { role });
  let body = opts?.enrichLink
    ? t("ack.bodyEnrich", { name, role, link: opts.enrichLink, team: t("team") })
    : t("ack.body", { name, role, team: t("team") });
  // Append the durable status-tracking link to whichever body variant — this is the
  // touchpoint that lets the candidate check where they stand after the tab is gone.
  if (opts?.statusLink) body += `\n\n${t("ack.statusLine", { link: opts.statusLink })}`;
  await sendCandidateComm(entry, t, { subject, body, kind: "acknowledgement" });
  recordAutomationEvent(entry.id, "acknowledgement_sent", role);
}

/** Outcome of an outreach dispatch: delivered, or SUPPRESSED for a consent reason
 *  (so the caller/UI shows "cannot contact" rather than a false "reached out"). */
export type OutreachResult = { sent: true } | { sent: false; reason: "anonymized" | "consent_expired" };

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
 *  path — this closes that gap. */
export async function dispatchOutreach(
  entry: PipelineEntry,
  draft: { subject?: unknown; body?: unknown }
): Promise<OutreachResult> {
  const suppress = outreachSuppressionReason({
    givenAt: entry.consentGivenAt,
    expiresAt: entry.consentExpiresAt,
    anonymizedAt: entry.anonymizedAt,
  });
  if (suppress) {
    // Audit the refusal so the absence of a send is visible, not silent.
    recordAutomationEvent(entry.id, "outreach_suppressed", suppress);
    return { sent: false, reason: suppress };
  }
  const t = await commsTranslator(entry.locale);
  const role = entry.jobTitle ?? t("aRole");
  const subject = String(draft.subject ?? t("outreach.subjectFallback", { role })).trim();
  const body = String(draft.body ?? "").trim();
  await sendCandidateComm(entry, t, { subject, body, kind: "outreach" });
  recordAutomationEvent(entry.id, "outreach_sent", entry.jobTitle ?? "");
  return { sent: true };
}

/**
 * Dispatch a rejection on a (human or policy) reject decision. Deterministic,
 * respectful template — no LLM, so it works in a batch policy pass and never
 * ghosts a rejected candidate. Early-career archetypes get an encouraging line,
 * keeping the fairness lever consistent through to the adverse comm.
 */
export async function dispatchRejection(entry: PipelineEntry, opts?: { automated?: boolean }): Promise<void> {
  const t = await commsTranslator(entry.locale);
  const name = greetName(entry, t);
  const role = entry.jobTitle ?? t("theRole");
  const middle = isEarlyCareer(entry.archetype) ? t("rejection.early") : t("rejection.standard");

  const subject = t("rejection.subject", { role });
  const body = t("rejection.opening", { name, role }) + middle + t("rejection.closing", { team: t("team") });

  await sendCandidateComm(entry, t, { subject, body, kind: "rejection" });
  recordAutomationEvent(entry.id, "rejection_sent", opts?.automated ? "policy auto-reject" : "manual reject");
}

/** Tell a KO-declined lead the outcome — entry-less by design. Channel leads are
 *  declined BEFORE any pipeline entry exists (lead-intake's knockout gate), so the
 *  one identity in hand is the inbound email; `ref` is omitted and the envelope
 *  ships null context (comms-envelope handles a missing entry). The own quick-apply
 *  form shows the decline live in the UI — this comm is for webhook surfaces whose
 *  candidate saw "submitted" on a third-party board and would otherwise hear
 *  nothing, ever. */
export async function dispatchKnockoutDecline(input: {
  email: string;
  name?: string | null;
  jobTitle?: string | null;
  locale?: string | null;
}): Promise<void> {
  const t = await commsTranslator(input.locale);
  const name = (input.name ?? "").trim() || t("there");
  const role = input.jobTitle ?? t("theRole");
  const subject = t("koDecline.subject", { role });
  const body = t("koDecline.body", { name, role, team: t("team") });
  await sendComm({ to: input.email, subject, body, kind: "ko_decline" });
}

/**
 * Deliver the (recruiter-approved) offer to the candidate with a token-gated
 * accept/decline link. The offer DECISION stays human — this fires only after a
 * recruiter extends the drafted offer. Appends the response link to the letter.
 * The letter body is the model's; only the fallback subject + response footer
 * localize.
 */
export async function dispatchOffer(
  entry: PipelineEntry,
  draft: { subject?: unknown; body?: unknown },
  responseLink: string
): Promise<void> {
  const t = await commsTranslator(entry.locale);
  const subject = String(draft.subject ?? t("offer.subjectFallback", { role: entry.jobTitle ?? t("aRole") })).trim();
  const letter = String(draft.body ?? "").trim();
  const body = `${letter}\n\n` + t("offer.responseFooter", { link: responseLink });
  await sendCandidateComm(entry, t, { subject, body, kind: "offer" });
  recordAutomationEvent(entry.id, "offer_sent", entry.jobTitle ?? "");
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
  opts?: { shortNotice?: boolean; durationMin?: number | null; rescheduleLink?: string | null }
): Promise<void> {
  const t = await commsTranslator(entry.locale);
  const name = greetName(entry, t);
  const role = entry.jobTitle ?? t("theRole");
  // Tell the candidate how long to block: a student's scripted screen runs ~22
  // minutes, and "booked for Tue 10:00" alone reads like a quick call.
  const length = opts?.durationMin ? t("interviewConfirmation.length", { minutes: opts.durationMin }) : "";
  const subject = t("interviewConfirmation.subject", { role });
  const body = opts?.shortNotice
    ? t("interviewConfirmation.short", { name, role, slot, length, team: t("team") })
    : t("interviewConfirmation.normal", { name, role, slot, length, team: t("team") });
  // The confirmation is the candidate's only durable artifact — once the tab
  // closes, this footer link is the one way back to reschedule (SCH2) or grab
  // the .ics. ABSOLUTE, resolved via publicBaseUrl by the caller.
  const footer = opts?.rescheduleLink ? `\n\n${t("interviewConfirmation.linkFooter", { link: opts.rescheduleLink })}` : "";
  await sendCandidateComm(entry, t, { subject, body: body + footer, kind: "interview_confirmation" });
  recordAutomationEvent(entry.id, "interview_scheduled", slot);
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
    if (entry.id && assigned) recordAutomationEvent(entry.id, "interviewer_brief_skipped", assigned);
    return false;
  }
  const t = await commsTranslator(opts.lang);
  const name = extractRecipientName(assigned) ?? t("there");
  const role = entry.jobTitle ?? t("theRole");
  const candidate = (entry.candidateLabel ?? "").trim() || t("there");
  const length = opts.durationMin ? t("interviewerBrief.length", { minutes: opts.durationMin }) : "";
  const focus = (opts.focusAreas ?? []).filter((f) => f && f.trim()).join(", ") || t("interviewerBrief.focusFallback");
  const scenario = opts.scenario?.trim() || t("interviewerBrief.scenarioFallback");
  const subject = t("interviewerBrief.subject", { candidate, role });
  let body = t("interviewerBrief.body", { name, candidate, role, slot, length, scenario, focus });

  // Inline .ics calendar hold — the candidate gets one client-side; the interviewer
  // got none. Built only when we know the absolute slot start. The outbox is a
  // plain-text channel, so it rides inline under a header, saveable as an .ics.
  if (opts.slotAtIso) {
    try {
      const ics = buildIcs({
        uid: `kp-interview-${entry.id ?? "x"}-${assigned.replace(/[^a-zA-Z0-9]+/g, "-")}`,
        start: opts.slotAtIso,
        durationMin: opts.durationMin && opts.durationMin > 0 ? opts.durationMin : 30,
        title: t("interviewerBrief.icsTitle", { candidate, role }),
        description: scenario,
      });
      body += `\n\n${t("interviewerBrief.calendarHeader")}\n${ics}`;
    } catch {
      /* unparseable slot — skip the hold; the brief itself still delivers */
    }
  }

  await sendComm({ to: address, subject, body, kind: "interviewer_brief", ref: entry.id ?? undefined });
  if (entry.id) recordAutomationEvent(entry.id, "interviewer_brief_sent", name);
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
): Promise<void> {
  const t = await commsTranslator(entry.locale);
  const name = greetName(entry, t);
  const role = entry.jobTitle ?? t("theRole");
  const length = opts?.durationMin ? t("scheduleInvite.length", { minutes: opts.durationMin }) : "";
  const subject = t("scheduleInvite.subject", { role });
  const body = t("scheduleInvite.body", { name, role, link, length, team: t("team") });
  await sendCandidateComm(entry, t, { subject, body, kind: "schedule_invite" });
  recordAutomationEvent(entry.id, "schedule_invite_sent", role);
}

/** Reminder fired by the scheduler heartbeat before a confirmed interview.
 *
 *  Delivery boundary matters here: the heartbeat retries a *throw* from this call,
 *  so a throw must mean "the message did NOT go out." The channel handoff (sendComm)
 *  is the only step that may throw — if it resolves, the candidate has been reminded.
 *  The audit write that follows is post-send bookkeeping; were it allowed to throw
 *  (e.g. a transient SQLite contention after the message already left), the caller
 *  would re-arm and send the candidate a DUPLICATE reminder. So it is logged and
 *  swallowed, never surfaced as a delivery failure. */
export async function dispatchInterviewReminder(
  entry: { id?: string | null; candidateLabel?: string | null; candidateId?: string | null; jobTitle?: string | null; locale?: string | null },
  slot: string,
  opts?: { durationMin?: number | null }
): Promise<void> {
  const t = await commsTranslator(entry.locale);
  const name = greetName(entry, t);
  const role = entry.jobTitle ?? t("theRole");
  const length = opts?.durationMin ? t("interviewReminder.length", { minutes: opts.durationMin }) : "";
  const subject = t("interviewReminder.subject", { slot });
  const body = t("interviewReminder.body", { name, role, slot, length, team: t("team") });
  await sendCandidateComm(entry, t, { subject, body, kind: "interview_reminder", ref: entry.id ?? slot });
  // Post-send: the reminder is delivered. Do not let an audit-log failure re-throw —
  // that would look like a delivery failure and trigger a duplicate send.
  try {
    if (entry.id) recordAutomationEvent(entry.id, "interview_reminder_sent", slot);
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
  opts?: { durationMin?: number | null }
): Promise<void> {
  const t = await commsTranslator(entry.locale);
  const name = greetName(entry, t);
  const role = entry.jobTitle ?? t("theRole");
  const length = opts?.durationMin ? t("interviewInvite.length", { minutes: opts.durationMin }) : "";
  const subject = t("interviewInvite.subject", { role });
  const body = t("interviewInvite.body", { name, role, link, length, team: t("team") });
  await sendCandidateComm(entry, t, { subject, body, kind: "interview_invite", ref: entry.id ?? link });
  if (entry.id) recordAutomationEvent(entry.id, "interview_invite_sent", role);
}

/**
 * Onboarding hook — fires when a candidate accepts and moves to Hired. A warm
 * welcome + the practical next step. Kept deterministic; a real onboarding
 * system would subscribe to the `onboarding_started` event downstream.
 */
export async function dispatchOnboarding(entry: PipelineEntry, onboardingToken?: string | null): Promise<void> {
  const t = await commsTranslator(entry.locale);
  const role = entry.jobTitle ?? t("yourNewRole");
  const subject = t("onboarding.subject", { role });
  // The accepted offer's token doubles as the candidate's onboarding link (offers #5):
  // accept now lands on a concrete next-step page, not just a "People will be in touch"
  // promise. ABSOLUTE via publicBaseUrl (the env override when there's no request origin);
  // omitted for a manual hire with no offer token, which keeps the welcome copy as-is.
  const footer = onboardingToken
    ? `\n\n${t("onboarding.linkFooter", { link: `${publicBaseUrl()}/onboarding/${onboardingToken}` })}`
    : "";
  const body = t("onboarding.body", { name: greetName(entry, t), role, team: t("team") }) + footer;
  await sendCandidateComm(entry, t, { subject, body, kind: "onboarding" });
  recordAutomationEvent(entry.id, "onboarding_started", role);
}

/** The single pre-boarding nudge (candidate-onboarding-hand-off #3): re-sends the
 *  /onboarding/{token} link when the questionnaire is still unsubmitted after the
 *  policy delay, so a hire who closed the welcome tab isn't lost to silence. Driven
 *  by the heartbeat sweep (preboarding-reminders.ts), at-most-once via the run's
 *  reminder_sent_at claim. `link` must be ABSOLUTE (resolved via publicBaseUrl by
 *  the caller — the candidate opens it outside the app). */
export async function dispatchPreboardingReminder(entry: PipelineEntry, link: string): Promise<void> {
  const t = await commsTranslator(entry.locale);
  const role = entry.jobTitle ?? t("yourNewRole");
  const subject = t("onboardingReminder.subject", { role });
  const body = t("onboardingReminder.body", { name: greetName(entry, t), role, link, team: t("team") });
  await sendCandidateComm(entry, t, { subject, body, kind: "onboarding_reminder", ref: entry.id ?? link });
  if (entry.id) recordAutomationEvent(entry.id, "onboarding_reminder_sent", role);
}

/** Format an offer's ISO deadline for the candidate's locale, or "" if absent/invalid
 *  (offers in the reminder window always carry one; the guard keeps the body clean). */
function formatOfferDeadline(iso: string | null, locale: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const loc = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return new Intl.DateTimeFormat(loc, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
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
  const t = await commsTranslator(entry.locale);
  const name = greetName(entry, t);
  const role = entry.jobTitle ?? t("theRole");
  const deadline = formatOfferDeadline(deadlineIso, entry.locale);
  const subject = t("offerReminder.subject", { role });
  const body = t("offerReminder.body", { name, role, deadline, link, team: t("team") });
  await sendCandidateComm(entry, t, { subject, body, kind: "offer_reminder", ref: entry.id ?? link });
  try {
    recordAutomationEvent(entry.id, "offer_reminder_sent", role);
  } catch (e) {
    console.error(`[offer-reminder] delivered but audit-log write failed for entry ${entry.id}: ${e instanceof Error ? e.message : e}`);
  }
}
