import { getOutboxEntry, listOutboxFiltered, type OutboxEntry } from "./db/devcase";
import { getPipelineEntry, recordAutomationEvent } from "./db/pipeline";
import { CommsBodyRejectedError, CommsSuppressedError, commsSendSuppression, sendComm } from "./comms";
import { entryContactability } from "./comms-contactability";
import { isDeliverableAddress } from "./comms-recipient";
import { relayHealth } from "./comms-relay";

// THE BACKLOG OFFER — letters that waited for a sender.
//
// With no relay a candidate letter is recorded as a terminal `queued` row and nothing
// dequeues it (comms-status.ts). Once a relay exists the owner may want those letters to
// go after all. This module is the OFFER and the CONFIRMED SEND, and nothing else:
//
//   • it never runs on its own. No relay save, no boot, no timer calls it; only the route
//     the owner's single "Send" press reaches (app/api/comms/backlog/route.ts).
//   • it is not a second sender. Every letter goes through `sendComm`, the one channel
//     handoff, so the relay URL rules, the org check, the send gate and the delivery
//     vocabulary (sent / failed, the refused-recipient row) are exactly a fresh send's.
//   • it is the resend door's twin for rows that were never attempted: the new row carries
//     the original's `messageId` (one identity per logical message, so a receiver drops a
//     repeat) and, for a refless letter, the original's id as its `ref`.
//
// A letter is OFFERED only while it is still a plain queued row nothing has superseded.
// "Superseded" is the resend door's dedup read: a newer sent/failed row of the same
// (ref, kind), or any sent/failed row carrying the same messageId. That is what makes the
// confirm idempotent — the first confirmation writes exactly such a row — and what keeps
// a letter that an automation already re-fired from being offered twice.
//
// Not detectable here: a letter the owner already sent BY HAND (Copy letter / Open in my
// email). Hand-send writes nothing to the record by design (letterHandSend.ts), so the
// preview is where the owner deselects those.

/** Most letters one confirmation will send. Also the size of the ledger window the offer
 *  reads (the store clamps to 500), so a larger backlog is offered in batches. */
export const BACKLOG_MAX = 100;
const WINDOW = 500;

/** Why a letter in the confirmation was NOT sent. */
export const BACKLOG_SKIP_REASONS = [
  "relay_not_ready",
  "too_many",
  "not_found",
  "not_offered",
  "already_sent",
  "in_progress",
  "recipient_invalid",
  "suppressed",
  "body_rejected",
] as const;
export type BacklogSkipReason = (typeof BACKLOG_SKIP_REASONS)[number];

export type BacklogLetter = {
  id: string;
  recipient: string;
  subject: string;
  /** When the letter was recorded (ISO). */
  recordedAt: string;
};

export type BacklogOffer = {
  /** A relay that actually delivers is wired (env or stored, secret readable). */
  relayReady: boolean;
  letters: BacklogLetter[];
};

export type BacklogResult =
  | { id: string; outcome: "sent" | "failed" | "queued"; detail?: string | null }
  | { id: string; outcome: "skipped"; reason: BacklogSkipReason; detail?: string | null };

/** The channel name of the local outbox (comms.ts OutboxChannel): the ONLY writer of a
 *  row that is queued for want of a sender. */
const LOCAL_OUTBOX_CHANNEL = "outbox";

/** A queued row that was meant for a real inbox and waited only for a sender: written by
 *  the local outbox channel (an allow-list, not a deny-list: a devcase feedback DRAFT is
 *  also `queued`, on the posting's channel, while it waits for the recruiter to read it,
 *  and must never leave on a backlog confirmation), carrying what a resend needs. Pure. */
export function isBacklogRow(row: OutboxEntry): boolean {
  if (row.status !== "queued") return false;
  if (row.channel !== LOCAL_OUTBOX_CHANNEL) return false;
  return Boolean(row.recipient && row.subject && row.body && row.kind);
}

/** Has a later delivery attempt already answered this letter? `others` is any slice of the
 *  ledger holding its siblings. Pure. A `queued` sibling does not count (it is another
 *  waiting letter); a `bounced` receipt is not a delivery. */
export function isSuperseded(row: OutboxEntry, others: readonly OutboxEntry[]): boolean {
  const key = row.ref ?? row.id;
  return others.some((m) => {
    if (m.id === row.id || m.kind !== row.kind) return false;
    if (m.status !== "sent" && m.status !== "failed") return false;
    if (row.messageId && m.messageId === row.messageId) return true;
    return m.ref === key && m.createdAt > row.createdAt;
  });
}

/** The letters to offer out of a ledger window (newest first, any statuses). Pure. */
export function selectBacklogOffer(window: readonly OutboxEntry[]): OutboxEntry[] {
  return window.filter((row) => isBacklogRow(row) && !isSuperseded(row, window));
}

/** The offer for one workspace. Empty unless a relay that delivers is configured: while
 *  none is, these letters are simply the queue and the ledger already says so. */
export function backlogOffer(ws: string): BacklogOffer {
  const health = relayHealth();
  const relayReady = health === "env" || health === "configured";
  if (!relayReady) return { relayReady, letters: [] };
  const letters = selectBacklogOffer(listOutboxFiltered({ limit: WINDOW }, ws))
    .slice(0, BACKLOG_MAX)
    .map((r) => ({ id: r.id, recipient: r.recipient ?? "", subject: r.subject ?? "", recordedAt: r.createdAt }));
  return { relayReady, letters };
}

// In-flight confirmations for this process, keyed by outbox id: a double click or a retry
// that races BEFORE the first send writes its row cannot dispatch the same letter twice.
const inFlight = new Set<string>();

const skipped = (id: string, reason: BacklogSkipReason, detail?: string | null): BacklogResult => ({ id, outcome: "skipped", reason, detail });

/** Send the letters the owner confirmed. `actor` is the signed-in person ("human:<name>")
 *  and is stamped on the candidate's history beside the delivery. Every letter is
 *  re-checked against the gates a fresh send passes today; one that fails a gate is
 *  skipped and named, never sent. Sequential on purpose: one letter's relay call finishes
 *  before the next begins. */
export async function confirmBacklogSend(ws: string, rawIds: readonly string[], actor: string): Promise<BacklogResult[]> {
  const ids = [...new Set(rawIds.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim()))];
  const health = relayHealth();
  const relayReady = health === "env" || health === "configured";
  const results: BacklogResult[] = [];
  for (const [index, id] of ids.entries()) {
    if (!relayReady) {
      results.push(skipped(id, "relay_not_ready"));
      continue;
    }
    if (index >= BACKLOG_MAX) {
      results.push(skipped(id, "too_many"));
      continue;
    }
    if (inFlight.has(id)) {
      results.push(skipped(id, "in_progress"));
      continue;
    }
    inFlight.add(id);
    try {
      results.push(await sendOne(ws, id, actor));
    } catch (error) {
      // The send threw something that is not a decision. Name the class, never the message
      // (it can carry the recipient); the row, if any was written, is in the ledger.
      console.error(`[comms-backlog] a confirmed letter could not be sent: ${error instanceof Error ? error.name : "unknown error"}`);
      results.push({ id, outcome: "failed", detail: null });
    } finally {
      inFlight.delete(id);
    }
  }
  return results;
}

async function sendOne(ws: string, id: string, actor: string): Promise<BacklogResult> {
  // Workspace scope: a letter of another team is simply not found.
  const original = getOutboxEntry(id, ws);
  if (!original) return skipped(id, "not_found");
  if (!isBacklogRow(original)) return skipped(id, "not_offered");
  const dedupRef = original.ref ?? original.id;
  if (isSuperseded(original, listOutboxFiltered({ ref: dedupRef, kind: original.kind ?? undefined }, ws))) {
    return skipped(id, "already_sent");
  }
  if (!isDeliverableAddress(original.recipient)) return skipped(id, "recipient_invalid");

  // Contactability: asked of the same send gate `sendComm` enforces (consent, erasure,
  // the opt-out / outreach halt), plus the agent population an entry-bound letter must
  // never reach. `unaddressable` is not asked: the letter's own recipient was judged above.
  const entry = original.ref ? getPipelineEntry(original.ref, ws) : null;
  const message = {
    to: original.recipient as string,
    subject: original.subject as string,
    body: original.body as string,
    kind: original.kind as string,
    ref: dedupRef,
    workspaceId: ws,
    messageId: original.messageId ?? undefined,
  };
  if (entry) {
    const verdict = entryContactability(entry, message.kind);
    if (!verdict.ok && verdict.reason !== "unaddressable") return skipped(id, "suppressed", verdict.reason);
  } else {
    const gate = commsSendSuppression({ ...message, ref: original.ref ?? undefined });
    if (gate) return skipped(id, "suppressed", gate);
  }

  let sent: OutboxEntry;
  try {
    sent = await sendComm(message);
  } catch (error) {
    if (error instanceof CommsSuppressedError) return skipped(id, "suppressed", error.reason);
    if (error instanceof CommsBodyRejectedError) return skipped(id, "body_rejected", error.reason);
    throw error;
  }
  if (entry) {
    recordAutomationEvent(
      entry.id,
      "comm_resent",
      `${message.kind}: ${sent.status} (owner-confirmed; recorded ${original.createdAt} while no relay existed)`,
      ws,
      actor
    );
  }
  if (sent.status === "sent") return { id, outcome: "sent" };
  if (sent.status === "queued") return { id, outcome: "queued" };
  return { id, outcome: "failed", detail: sent.failureDetail };
}
