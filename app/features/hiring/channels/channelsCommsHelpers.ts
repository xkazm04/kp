// Pure types + helpers for the Comms ledger (ChannelsCommsTable), split out so
// the table file stays under the 200-line cap.
//
// channels-i18n-honesty: the status vocabulary and the timestamp format live here,
// but the WORDS come from `channels.comms.*` in four locales — this module never
// carries English. The verdict itself is derived once in comms-view.ts and only
// mapped to a tone here.

import type { OutboxStatus } from "@/app/_lib/comms-status";
import type { BadgeTone } from "@/app/_components/Badge";
import { commsVerdict, isReceiptRecipient, isReceiptSubject } from "@/app/_lib/comms-view";
import { labelize } from "@/app/_lib/format";

export type Message = {
  id: string;
  recipient: string | null;
  subject: string | null;
  body: string | null;
  kind: string | null;
  channel: string | null;
  status: OutboxStatus;
  ref: string | null;
  createdAt: string;
  recovered?: boolean;
  recoveredAt?: string | null;
  deliverable?: boolean;
  bounced?: boolean;
  bouncedAt?: string | null;
  bounceDetail?: string | null;
  /** A relay receipt that matched no send of ours (see comms-view.ts). */
  orphaned?: boolean;
  /** WHY a `failed` row dead-lettered — null on legacy rows written before the
   *  column existed, which must read as "no reason recorded", not as a clean send. */
  failureDetail?: string | null;
};
export type RefInfo = { label: string; jobTitle: string | null };

// A dead letter (failed, not yet recovered by a later resend), a sent row the relay
// later bounced, or an unmatched relay receipt — all three need the recruiter (or the
// integrator) to chase.
export const isActionable = (m: Message) =>
  (m.status === "failed" && !m.recovered) || Boolean(m.bounced) || Boolean(m.orphaned);

/** The catalog labels the ledger renders for one verdict. They are also the Status
 *  filter's option set, so the filter and the column it filters always read alike in
 *  every locale. */
export type StatusLabels = Record<"orphaned" | "bounced" | "recovered" | "failed" | "sent" | "queued", string>;

/** Build the label set from a `channels.comms` translator — ONE definition, shared by
 *  the table (which needs it for the filter options), the rows and the detail modal. */
type StatusLabelKey = "orphanBadge" | "statusBounced" | "statusRecovered" | "statusFailed" | "statusSent" | "statusQueued";

export function commsStatusLabels(t: (key: StatusLabelKey) => string): StatusLabels {
  return {
    orphaned: t("orphanBadge"),
    bounced: t("statusBounced"),
    recovered: t("statusRecovered"),
    failed: t("statusFailed"),
    sent: t("statusSent"),
    queued: t("statusQueued"),
  };
}

// Tone + copy for ONE shared verdict (comms-view.ts `commsVerdict`) — the same
// derivation the candidate drawer renders, so the two surfaces can no longer disagree
// about the same message. This function only decides how a verdict LOOKS here.
export function statusTone(m: Message, labels: StatusLabels): { tone: BadgeTone; label: string } {
  switch (commsVerdict(m)) {
    case "orphaned":
      return { tone: "caution", label: labels.orphaned };
    case "bounced":
      return { tone: "critical", label: labels.bounced };
    case "recovered":
      return { tone: "positive", label: labels.recovered };
    case "failed":
      return { tone: "critical", label: labels.failed };
    case "sent":
      return { tone: "positive", label: labels.sent };
    case "queued":
      return { tone: "info", label: labels.queued };
    default:
      return { tone: "neutral", label: labelize(m.status) };
  }
}

// A delivery-receipt row carries CODES where a message carries a subject and a
// recipient (comms-view.ts RECEIPT_*_CODE): it is written by a relay callback that has
// no reader and no request locale, so the ledger stores what the row IS and this
// surface says it in the reader's language. Legacy rows — written before the codes,
// carrying the English literals — resolve through the same predicates, so the table
// has no line of untranslated English left in it.
export type ReceiptLabels = { subject: string; recipient: string };

export function commsReceiptLabels(t: (key: "receiptSubject" | "receiptRecipient") => string): ReceiptLabels {
  return { subject: t("receiptSubject"), recipient: t("receiptRecipient") };
}

/** The subject to SHOW for a row — the stored one, or the localized receipt label. */
export const displaySubject = (m: Message, labels: ReceiptLabels): string | null =>
  isReceiptSubject(m.subject) ? labels.subject : m.subject;

/** …and the recipient, for the name column, the search index and the modal subtitle. */
export const displayRecipient = (m: Message, labels: ReceiptLabels): string | null =>
  isReceiptRecipient(m.recipient) ? labels.recipient : m.recipient;

// RECORDED, not "Sent". The header said Sent over EVERY row — including the queued
// ones nothing will deliver and the failed ones that never left — and rendered a bare
// DATE, which made an original and its same-day resend indistinguishable. The column
// now states what the timestamp actually is (when kp recorded the row) and shows the
// time as well, so the two are told apart at a glance.
export const formatRecordedAt = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
