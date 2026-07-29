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

// The capability bit itself (isRelayConfigured) lives in comms-relay.ts now that
// the relay is UI-configurable (env → stored config): it reads the DB, so it is
// server-only. This module stays import-free so deliveryClaim remains loadable
// by client bundles and the bare unit runner alike.

// ---- INBOUND email capability (inbound-setup-honesty) -----------------------
//
// The OUTBOUND twin of isRelayConfigured, and the same doctrine applied to the
// other direction. kp has exactly ONE real receiver: the HTTP endpoint
// /api/channels/inbound/[token]. There is no inbound-email provider and no MX
// route anywhere in the repo — yet the Email intake wizard used to SYNTHESIZE a
// forwarding address from window.location (`hook_x@inbound.<host>`, falling back
// to the literal `inbound.kp.app`) and walk the recruiter through pointing a real
// Gmail/Outlook rule at it. Applications forwarded there vanish: nothing on the
// internet accepts that mailbox.
//
// So the address is a CAPABILITY, not a derivation. EMAIL_INBOUND_DOMAIN names the
// domain a configured inbound-email provider (Postmark/SendGrid/Mailgun inbound,
// or a mail server) routes to the receiver token. Unset ⇒ the wizard shows the real
// HTTP receiver URL and says forwarding isn't wired, instead of inventing a mailbox.

/** The configured inbound-email domain, normalized (scheme/path/@ stripped,
 *  lower-cased), or null when nothing is wired. NEVER derived from a request
 *  origin — a hostname the app is served on says nothing about mail routing. */
export function emailInboundDomain(): string | null {
  const raw = (process.env.EMAIL_INBOUND_DOMAIN ?? "").trim().toLowerCase();
  if (!raw) return null;
  const host = raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "") // a pasted https:// prefix
    .replace(/^.*@/, "") // a pasted whole address
    .replace(/[/?#].*$/, "") // a pasted path
    .replace(/\.$/, "")
    .trim();
  // Must look like a domain: at least one dot, no whitespace, no stray @.
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
}

/** Is inbound email forwarding actually wired? THE capability bit the Email intake
 *  wizard keys every address + forwarding instruction off (mirrors isRelayConfigured). */
export function isEmailInboundConfigured(): boolean {
  return emailInboundDomain() !== null;
}

/** The real forwarding address for a receiver token, or null when unconfigured —
 *  in which case there is NO address to show and the caller must fall back to the
 *  HTTP receiver URL rather than fabricate one. */
export function emailInboundAddress(token: string): string | null {
  const domain = emailInboundDomain();
  return domain && token ? `${token}@${domain}` : null;
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
