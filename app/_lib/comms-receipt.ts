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

import { getSubmission, hasOutboxSendFor, recordOutbox, stampOutboxDelivered } from "./db/devcase";
import { getEntryWorkspace, getPipelineEntry } from "./db/pipeline";
import { orgIdForWorkspace } from "./db/org-benchmarks";
import { DEFAULT_ORG_ID } from "./db/organizations";
import { isBounceOutcome } from "./comms-status";
import { logForeignReceipt } from "./logger";
import { RECEIPT_RECIPIENT_CODE, RECEIPT_SUBJECT_CODE } from "./comms-view";
import { getRelayConfig } from "./comms-relay-store";

/** A relay's positive receipt: the message reached the recipient. Stamped on the send as
 *  `lastDeliveredAt`; "opened"/"deferred" are still accepted and not surfaced. */
function isDeliveredOutcome(outcome: string): boolean {
  return outcome.trim().toLowerCase() === "delivered";
}

export type DeliveryReceipt = {
  /** The message's ref (a pipeline entry id) and kind — together the ONLY key a
   *  receipt carries. */
  ref: string;
  kind: string;
  outcome: string;
  detail?: string | null;
  recipient?: string | null;
  /** The `messageId` the relay received in the envelope, echoed back. When present it
   *  names the exact send the receipt concerns; absent, the (ref, kind) heuristic applies. */
  messageId?: string | null;
};

export type DeliveryReceiptResult =
  | {
      recorded: false;
      outcome: string;
      reason?: "not_a_bounce" | "no_matching_send" | "unknown_ref";
      stored?: boolean;
    }
  | { recorded: true; outcome: string };

/**
 * WHICH TEAM does this receipt belong to?
 *
 * Neither door that applies a receipt carries a tenant. The live callback
 * authenticates against COMMS_CALLBACK_SECRET — a single process-wide env secret with
 * no workspace on it — and the relay config it belongs to is one global row
 * (comms-relay-store.ts, `id = 1`), so there is no "the workspace this callback
 * authenticated for" to read. The edge drain is signed per-install, not per-team.
 *
 * The `ref` is therefore the ONLY tenant signal a receipt carries, and it is a good
 * one: it is the id of the thing that was messaged. Resolved in the order the outbox
 * itself files rows —
 *   1. a PIPELINE ENTRY with that id → its team (the ordinary candidate comm);
 *   2. else a DEV-CASE SUBMISSION with that id → its team (the acknowledgement /
 *      feedback letters, whose `ref` is a submission id and which recordOutbox's own
 *      entry-derivation therefore cannot resolve);
 *   3. else NOTHING — and that is the case this function exists for.
 *
 * A receipt whose ref names nothing in this install used to be written into the
 * DEFAULT team's outbox, because that is where `recordOutbox` files a row it cannot
 * place. So an integrator posting a foreign ref scheme filled ONE team's Comms Center
 * with red unmatched receipts about candidates that team has never heard of, while
 * the fault belonged to no team at all. It is now refused and stored NOWHERE: the
 * relay still learns on the first call that the pair landed nowhere
 * (`reason: "unknown_ref"`), which is the whole point of answering an orphan, and no
 * tenant's ledger is polluted with another party's mistake.
 *
 * A ref that names a real entry but no matching SEND is unchanged: it has a team, so
 * it is still stored there and still reported `no_matching_send`.
 */
function receiptWorkspace(ref: string): string | null {
  try {
    const entryWs = getEntryWorkspace(ref);
    if (getPipelineEntry(ref, entryWs)) return entryWs;
  } catch {
    // An unreadable pipeline store must not decide the tenant question by itself —
    // fall through to the submission probe, and to the refusal below if that misses.
  }
  try {
    const sub = getSubmission(ref);
    if (sub?.workspaceId) return sub.workspaceId;
  } catch {
    /* same: an unreadable dev-case store leaves the ref unplaced, never default-placed */
  }
  return null;
}

/**
 * WHICH ORGANIZATION does this receipt belong to? (F-3)
 *
 * The same resolution `receiptWorkspace` performs, lifted one level: the ref's team, then
 * that team's org. A team with no `org_id` folds to the default org, exactly as
 * `WebhookChannel.crossOrgRefusal` folds it — so a single-org install answers
 * `org-default` for everything and no boundary built on this bites there.
 *
 * `null` means the ref is PLACEABLE NOWHERE, and it is deliberately not folded to the
 * default org: `recordDeliveryReceipt` already refuses that case as `unknown_ref` and files
 * it nowhere, and folding it would let an org-boundary check mask that answer with a
 * different one. The caller treats null as "no org to compare" and lets the refusal below
 * do its job.
 *
 * Exported for the edge drain, whose signed envelope proves an INSTALL and not a tenant:
 * a receipt it applies on behalf of one organization's edge must not write into another's
 * ledger (edge-drain.ts applyEvent).
 */
export function receiptOrgId(ref: string): string | null {
  const workspaceId = receiptWorkspace(ref);
  if (!workspaceId) return null;
  return orgIdForWorkspace(workspaceId) ?? DEFAULT_ORG_ID;
}

/**
 * Does the LIVE callback's receipt belong to an organization other than the one that
 * owns the relay sending it? (The edge drain's F-3 check, on the other door.)
 *
 * The callback authenticates with COMMS_CALLBACK_SECRET, which proves "the relay", and
 * the relay is the one a single organization saved (comms_relay_config.owner_org_id —
 * WebhookChannel.crossOrgRefusal already refuses to send it anyone else's letters). So a
 * receipt it reports for another organization's ref concerns nothing it was handed, and
 * filing it would let one org's relay vendor bounce, or stamp delivered, another org's
 * messages. Precedence mirrors resolveRelay: an ENV relay (COMMS_WEBHOOK_URL) is
 * host-level and serves every org, so it is not checked; nor is an install with no
 * stored relay. A ref placeable nowhere is left to recordDeliveryReceipt's own
 * `unknown_ref` refusal. Fails OPEN on an unreadable config row, as the single-tenant
 * default every shipped install runs is unaffected either way.
 */
export function receiptOutsideRelayOrg(ref: string, env: Readonly<Partial<NodeJS.ProcessEnv>> = process.env): boolean {
  if (env.COMMS_WEBHOOK_URL) return false;
  let owner: string;
  try {
    const stored = getRelayConfig();
    if (!stored.url) return false;
    owner = stored.ownerOrgId ?? DEFAULT_ORG_ID;
  } catch {
    return false; // unreadable config: the send path reports it (comms-relay.ts); no org to compare
  }
  const receiptOrg = receiptOrgId(ref);
  return receiptOrg !== null && receiptOrg !== owner;
}

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
  const messageId = receipt.messageId?.trim() || null;
  if (!isBounceOutcome(outcome)) {
    // A delivery is stamped on the send it concerns (last_delivered_at) instead of being
    // dropped; nothing is appended and the answer is unchanged. An unplaceable ref
    // stamps nothing — the same refusal the bounce path makes.
    if (isDeliveredOutcome(outcome) && receiptWorkspace(ref)) stampOutboxDelivered(ref, kind, messageId);
    return { recorded: false, outcome, reason: "not_a_bounce" };
  }
  const detail = receipt.detail && receipt.detail.trim() ? receipt.detail.trim() : outcome;
  // A receipt with no tenant is a fault belonging to nobody — refused, not filed into
  // whichever team happens to be the default (see receiptWorkspace).
  const workspaceId = receiptWorkspace(ref);
  if (!workspaceId) {
    // Filed nowhere, but not traceless: counted install-wide (logger.ts
    // logForeignReceipt), because a wholesale ref-scheme drift arrives entirely here.
    void logForeignReceipt({ ref, kind, outcome });
    return { recorded: false, outcome, reason: "unknown_ref", stored: false };
  }
  // CODES, not prose: this row is written by a relay callback with no reader and no
  // request locale, and the outbox is append-only — an English literal here is English
  // in a Czech team's ledger forever. The surface renders them (comms-view.ts
  // RECEIPT_*_CODE → channels.comms.receipt*).
  const recipient = receipt.recipient && receipt.recipient.trim() ? receipt.recipient.trim() : RECEIPT_RECIPIENT_CODE;
  const matched = hasOutboxSendFor(ref, kind);
  recordOutbox({
    recipient,
    subject: RECEIPT_SUBJECT_CODE,
    body: detail,
    kind,
    channel: "relay-callback",
    status: "bounced",
    ref,
    workspaceId,
    messageId,
  });
  if (!matched) return { recorded: false, outcome, reason: "no_matching_send", stored: true };
  return { recorded: true, outcome };
}
