import { sendComm } from "./comms";
import { recordAutomationEvent, type PipelineEntry } from "./db";

// Direction #3 — real comms delivery for the hiring pipeline. Routes recruiter
// automation through the shared sendComm channel (durable local outbox by
// default, a real relay when COMMS_WEBHOOK_URL is set) so outreach and
// rejections actually reach the candidate — and land in the same Outbox audit
// log as the dev lifecycle's comms. Mirrors the inline-template pattern already
// used by distribution.ts (intake ack) and devcase-orchestrator.ts (invite).

// No candidate email is stored in the data model yet, so the human-readable
// candidate label is the recipient; a configured relay/ATS maps it to a real
// address (the email-enrichment hook — see the automation-pipeline-gaps note).
export function candidateRecipient(entry: { candidateLabel?: string | null; candidateId?: string | null }): string {
  return (entry.candidateLabel ?? "").trim() || (entry.candidateId ?? "").trim() || "candidate";
}

const EARLY = new Set(["student", "career_switcher"]);

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
  const early = EARLY.has((entry.archetype ?? "").trim());

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
