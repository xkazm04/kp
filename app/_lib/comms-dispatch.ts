import { createTranslator } from "next-intl";
import { sendComm } from "./comms";
import { recordAutomationEvent, type PipelineEntry } from "./db";
import { isEarlyCareer } from "./archetypes";
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
  opts?: { enrichLink?: string }
): Promise<void> {
  const t = await commsTranslator(entry.locale);
  const role = entry.jobTitle ?? t("theRole");
  const name = greetName(entry, t);
  const subject = t("ack.subject", { role });
  const body = opts?.enrichLink
    ? t("ack.bodyEnrich", { name, role, link: opts.enrichLink, team: t("team") })
    : t("ack.body", { name, role, team: t("team") });
  await sendComm({ to: candidateRecipient(entry), subject, body, kind: "acknowledgement", ref: entry.id });
  recordAutomationEvent(entry.id, "acknowledgement_sent", role);
}

/** Dispatch an outreach message — the LLM/deterministic draft just generated.
 *  The body is the model's; only the fallback subject (used when the draft has
 *  none) localizes. */
export async function dispatchOutreach(
  entry: PipelineEntry,
  draft: { subject?: unknown; body?: unknown }
): Promise<void> {
  const t = await commsTranslator(entry.locale);
  const role = entry.jobTitle ?? t("aRole");
  const subject = String(draft.subject ?? t("outreach.subjectFallback", { role })).trim();
  const body = String(draft.body ?? "").trim();
  await sendComm({ to: candidateRecipient(entry), subject, body, kind: "outreach", ref: entry.id });
  recordAutomationEvent(entry.id, "outreach_sent", entry.jobTitle ?? "");
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

  await sendComm({ to: candidateRecipient(entry), subject, body, kind: "rejection", ref: entry.id });
  recordAutomationEvent(entry.id, "rejection_sent", opts?.automated ? "policy auto-reject" : "manual reject");
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
  await sendComm({ to: candidateRecipient(entry), subject, body, kind: "offer", ref: entry.id });
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
  opts?: { shortNotice?: boolean; durationMin?: number | null }
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
  await sendComm({ to: candidateRecipient(entry), subject, body, kind: "interview_confirmation", ref: entry.id });
  recordAutomationEvent(entry.id, "interview_scheduled", slot);
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
  await sendComm({ to: candidateRecipient(entry), subject, body, kind: "interview_reminder", ref: entry.id ?? slot });
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
  await sendComm({ to: candidateRecipient(entry), subject, body, kind: "interview_invite", ref: entry.id ?? link });
  if (entry.id) recordAutomationEvent(entry.id, "interview_invite_sent", role);
}

/**
 * Onboarding hook — fires when a candidate accepts and moves to Hired. A warm
 * welcome + the practical next step. Kept deterministic; a real onboarding
 * system would subscribe to the `onboarding_started` event downstream.
 */
export async function dispatchOnboarding(entry: PipelineEntry): Promise<void> {
  const t = await commsTranslator(entry.locale);
  const role = entry.jobTitle ?? t("yourNewRole");
  const subject = t("onboarding.subject", { role });
  const body = t("onboarding.body", { name: greetName(entry, t), role, team: t("team") });
  await sendComm({ to: candidateRecipient(entry), subject, body, kind: "onboarding", ref: entry.id });
  recordAutomationEvent(entry.id, "onboarding_started", role);
}
