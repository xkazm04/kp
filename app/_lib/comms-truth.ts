// REC-10 — the ONE honest delivery vocabulary. The channel layer (comms.ts /
// comms-status.ts) defines `queued` as a TERMINAL non-delivery state: with no
// relay configured (COMMS_WEBHOOK_URL unset) every candidate message is a local
// dev_outbox row and NOTHING reaches a candidate. Yet ~8 surface families used
// to translate "row recorded" into "sent / we've emailed you". Every claim
// surface now resolves its language through this module:
//
//   sent   — a relay took the message (HTTP 2xx) → "sent/odesláno" is TRUE.
//   queued — recorded in the local outbox, nothing will deliver it →
//            "prepared/queued — delivery not configured" phrasing.
//   failed — relay configured but the send dead-lettered (or the dispatch call
//            threw) → the existing loud failure copy.
//
// Kept import-free apart from the comms-status TYPE so the Node unit runner
// (type-stripping, no bundler) can load it directly — the selector is
// unit-tested in comms-truth.test.ts.

import type { OutboxStatus } from "./comms-status";

export type DeliveryClaim = "sent" | "queued" | "failed";

/** Is a real delivery relay wired? THE capability bit every "sent" claim keys
 *  off — same source of truth the channel selection (comms.ts getCommsChannel)
 *  and the Comms Center's red "NOT being sent" banner use. */
export function isRelayConfigured(): boolean {
  return Boolean(process.env.COMMS_WEBHOOK_URL);
}

/**
 * The truthful claim for one message. Prefers the outbox row's REAL status
 * (queued / sent / failed / bounced) when the caller has it; a surface with no
 * per-message row falls back to capability — a configured relay earns "sent"
 * (the WebhookChannel records sent/failed explicitly, so the blind case is the
 * optimistic one), no relay means the row is a terminal `queued` by contract.
 * A `bounced` receipt means the green "sent" was really undeliverable — treat
 * it as the failure it is.
 */
export function deliveryClaim(relayConfigured: boolean, status?: OutboxStatus | null): DeliveryClaim {
  if (status === "failed" || status === "bounced") return "failed";
  if (status === "sent") return "sent";
  if (status === "queued") return "queued";
  return relayConfigured ? "sent" : "queued";
}
