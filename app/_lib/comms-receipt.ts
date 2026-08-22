// Recording one asynchronous delivery receipt — the half of POST /api/comms/callback
// that is NOT about authenticating the caller.
//
// It was lifted out when the edge drain (docs/concepts/local-first-edge.md §3.2)
// became a second door onto the same fact: a relay that bounced a message while the
// studio was closed hands the receipt to the edge, and the drain applies it later.
// The two doors authenticate very differently (a shared secret + freshness window on
// the live route; an HMAC-signed drain envelope from the edge) and must NOT share
// that. What they must share is what a bounce MEANS — which rows it writes, and when
// it is an orphan — because a second copy of that is how the Comms Center starts
// disagreeing with itself.

import { hasOutboxSendFor, recordOutbox } from "./db/devcase";
import { isBounceOutcome } from "./comms-status";

export type DeliveryReceipt = {
  /** The message's ref (a pipeline entry id) and kind — together the ONLY key a
   *  receipt carries. */
  ref: string;
  kind: string;
  outcome: string;
  detail?: string | null;
  recipient?: string | null;
};

export type DeliveryReceiptResult =
  | { recorded: false; outcome: string; reason?: "not_a_bounce" | "no_matching_send"; stored?: boolean }
  | { recorded: true; outcome: string };

/**
 * Apply one receipt. Positive/soft outcomes (delivered/opened/deferred) are
 * ACCEPTED but not surfaced — only the hard, reputation-critical ones record the
 * append-only `bounced` row that supersedes a green `sent` in the Comms Center
 * (deriveCommsView). An orphan receipt — one naming a (ref, kind) pair we never
 * sent — is still STORED (its orphan state is derived, never frozen into a column,
 * so it self-heals if the send arrives out of order) and reported as such, because
 * a relay reading `recorded: true` over a receipt that lands nowhere is a silent
 * integration failure.
 */
export function recordDeliveryReceipt(receipt: DeliveryReceipt): DeliveryReceiptResult {
  const { ref, kind, outcome } = receipt;
  if (!isBounceOutcome(outcome)) return { recorded: false, outcome, reason: "not_a_bounce" };
  const detail = receipt.detail && receipt.detail.trim() ? receipt.detail.trim() : outcome;
  const recipient = receipt.recipient && receipt.recipient.trim() ? receipt.recipient.trim() : "(relay callback)";
  const matched = hasOutboxSendFor(ref, kind);
  recordOutbox({
    recipient,
    subject: "Delivery receipt",
    body: detail,
    kind,
    channel: "relay-callback",
    status: "bounced",
    ref,
  });
  if (!matched) return { recorded: false, outcome, reason: "no_matching_send", stored: true };
  return { recorded: true, outcome };
}
