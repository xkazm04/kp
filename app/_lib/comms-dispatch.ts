import { sendComm } from "./comms";
import { recordAutomationEvent, type PipelineEntry } from "./db";
import { isEarlyCareer } from "./archetypes";

// Direction #3 — real comms delivery for the hiring pipeline. Routes recruiter
// automation through the shared sendComm channel (durable local outbox by
// default, a real relay when COMMS_WEBHOOK_URL is set) so outreach and
// rejections actually reach the candidate — and land in the same Outbox audit
// log as the dev lifecycle's comms. Mirrors the inline-template pattern already
// used by distribution.ts (intake ack) and devcase-orchestrator.ts (invite).

// RECIPIENT CONTRACT (full write-up in docs/COMMS_DELIVERY.md). The data model
// stores no candidate email, so a relay never receives a deliverable address from
// us — it receives a best-effort *identifier* it must resolve itself, in priority:
//   1. candidateLabel — the human display name (the normal case; an ATS/relay maps
//      name → address via its own directory).
//   2. candidateId    — a stable opaque id when no label exists.
//   3. "candidate"    — last-resort literal. UNADDRESSABLE: a relay cannot deliver
//      to it, so the message will dead-letter. `ref` (the entry id) on every
//      OutboundMessage keeps even this case traceable in the Outbox audit log.
// This is the documented email-enrichment seam: store/resolve a real address here
// before wiring a production relay.
export function candidateRecipient(entry: { candidateLabel?: string | null; candidateId?: string | null }): string {
  return (entry.candidateLabel ?? "").trim() || (entry.candidateId ?? "").trim() || "candidate";
}

/** Dispatch an outreach message — the LLM/deterministic draft just generated. */
export async function dispatchOutreach(
  entry: PipelineEntry,
  draft: { subject?: unknown; body?: unknown }
): Promise<void> {
  const subject = String(draft.subject ?? `An opportunity: ${entry.jobTitle ?? "a role"}`).trim();
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
  const name = (entry.candidateLabel ?? "").trim() || "there";
  const role = entry.jobTitle ?? "the role";
  const early = isEarlyCareer(entry.archetype);

  const subject = `Your application — ${role}`;
  const body =
    `Hi ${name},\n\n` +
    `Thank you for your interest in ${role} and for the time you put into your application. ` +
    `After careful review, we won't be moving forward at this stage.\n\n` +
    (early
      ? `This is not a reflection of your potential. Early in a career the strongest signal is trajectory, ` +
        `and we'd genuinely encourage you to apply again as you build out more hands-on experience — ` +
        `we'll keep your profile on file.\n\n`
      : `The decision came down to fit against the specific needs of this role right now, not a judgement of your ability. ` +
        `We'd welcome a future application as our teams and openings evolve, and we'll keep your profile on file.\n\n`) +
    `Wishing you the very best,\nThe hiring team`;

  await sendComm({ to: candidateRecipient(entry), subject, body, kind: "rejection", ref: entry.id });
  recordAutomationEvent(entry.id, "rejection_sent", opts?.automated ? "policy auto-reject" : "manual reject");
}

/**
 * Deliver the (recruiter-approved) offer to the candidate with a token-gated
 * accept/decline link. The offer DECISION stays human — this fires only after a
 * recruiter extends the drafted offer. Appends the response link to the letter.
 */
export async function dispatchOffer(
  entry: PipelineEntry,
  draft: { subject?: unknown; body?: unknown },
  responseLink: string
): Promise<void> {
  const subject = String(draft.subject ?? `Offer — ${entry.jobTitle ?? "a role"}`).trim();
  const letter = String(draft.body ?? "").trim();
  const body =
    `${letter}\n\n` +
    `— — —\n` +
    `To accept or decline this offer, please use your secure link:\n${responseLink}\n`;
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
  const name = (entry.candidateLabel ?? "").trim() || "there";
  const role = entry.jobTitle ?? "the role";
  // Tell the candidate how long to block: a student's scripted screen runs ~22
  // minutes, and "booked for Tue 10:00" alone reads like a quick call.
  const length = opts?.durationMin ? ` Please set aside about ${opts.durationMin} minutes for the call.` : "";
  const subject = `Interview confirmed — ${role}`;
  const body = opts?.shortNotice
    ? `Hi ${name},\n\n` +
      `Your interview for ${role} is booked for ${slot} — that's coming up shortly, ` +
      `so treat this as your heads-up: everything you need is right here and we won't ` +
      `send a separate reminder given the short notice.${length}\n\n` +
      `If you need to change the time, just reply and we'll sort it out.\n\nSee you soon,\nThe hiring team`
    : `Hi ${name},\n\n` +
      `Your interview for ${role} is booked for ${slot}.${length} ` +
      `We'll send a reminder before the call with everything you need.\n\n` +
      `If you need to change the time, just reply and we'll sort it out.\n\nSee you then,\nThe hiring team`;
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
  entry: { id?: string | null; candidateLabel?: string | null; candidateId?: string | null; jobTitle?: string | null },
  slot: string,
  opts?: { durationMin?: number | null }
): Promise<void> {
  const name = (entry.candidateLabel ?? "").trim() || "there";
  const role = entry.jobTitle ?? "the role";
  const length = opts?.durationMin ? ` Plan for about ${opts.durationMin} minutes.` : "";
  const subject = `Reminder — your interview ${slot}`;
  const body =
    `Hi ${name},\n\n` +
    `A quick reminder that your interview for ${role} is coming up at ${slot}.${length} ` +
    `We're looking forward to speaking with you — see you then!\n\nThe hiring team`;
  await sendComm({ to: candidateRecipient(entry), subject, body, kind: "interview_reminder", ref: entry.id ?? slot });
  // Post-send: the reminder is delivered. Do not let an audit-log failure re-throw —
  // that would look like a delivery failure and trigger a duplicate send.
  try {
    if (entry.id) recordAutomationEvent(entry.id, "interview_reminder_sent", slot);
  } catch (e) {
    console.error(`[reminder] delivered but audit-log write failed for entry ${entry.id}: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Onboarding hook — fires when a candidate accepts and moves to Hired. A warm
 * welcome + the practical next step. Kept deterministic; a real onboarding
 * system would subscribe to the `onboarding_started` event downstream.
 */
export async function dispatchOnboarding(entry: PipelineEntry): Promise<void> {
  const name = (entry.candidateLabel ?? "").trim() || "there";
  const role = entry.jobTitle ?? "your new role";
  const subject = `Welcome aboard — ${role}`;
  const body =
    `Hi ${name},\n\n` +
    `We're delighted you're joining us as ${role}! Welcome to the team.\n\n` +
    `Your onboarding is now underway. Our People team will reach out shortly with your start date, ` +
    `paperwork, equipment, and a first-week plan so you can hit the ground running.\n\n` +
    `We can't wait to work with you.\n\nWarmly,\nThe hiring team`;
  await sendComm({ to: candidateRecipient(entry), subject, body, kind: "onboarding", ref: entry.id });
  recordAutomationEvent(entry.id, "onboarding_started", role);
}
