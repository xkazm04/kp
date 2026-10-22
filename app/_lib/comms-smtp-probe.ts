import { egressSealed } from "./egress-seal";
import { randomId } from "./random-id";
import { resolveSmtp, smtpHealth } from "./comms-relay";
import { deliverOverSmtp } from "./comms-smtp-delivery";
import { recordSmtpAttempt } from "./comms-smtp-store";
import type { SmtpOutcome } from "./comms-smtp";

// T6 — the Send test letter (POST /api/comms/smtp/test): one real message from the stored
// mailbox to the same mailbox, through the same vetted delivery boundary a candidate
// letter takes. Single attempt. The outcome is recorded on the sender's attempt list, so
// the card shows it beside the real sends.

export type SmtpTestResult =
  | { kind: "sealed" }
  | { kind: "unconfigured" }
  | { kind: "unreadable" }
  | { kind: "attempted"; to: string; outcome: SmtpOutcome };

export async function sendSmtpTestLetter(): Promise<SmtpTestResult> {
  // The seal answers BEFORE the sender is resolved: "sealed" is not "not configured".
  if (egressSealed()) return { kind: "sealed" };
  const cfg = resolveSmtp();
  if (!cfg) return { kind: smtpHealth() === "unreadable" ? "unreadable" : "unconfigured" };
  const messageId = randomId("msg");
  const outcome = await deliverOverSmtp(cfg, {
    from: cfg.address,
    fromName: cfg.fromName,
    to: cfg.address,
    subject: "kp test letter",
    body:
      "This is a test letter from your kp workspace.\n\n" +
      "If you can read it, candidate letters will be sent from this mailbox.\n",
    messageId,
  });
  try {
    recordSmtpAttempt({
      kind: "test",
      to: cfg.address,
      messageId,
      outcome: outcome.ok ? "sent" : "failed",
      stage: outcome.ok ? null : outcome.stage,
      code: outcome.code,
      text: outcome.text,
    });
  } catch (err) {
    console.error(`[comms-smtp] could not record the test attempt:`, err);
  }
  return { kind: "attempted", to: cfg.address, outcome };
}
