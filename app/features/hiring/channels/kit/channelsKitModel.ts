/*
 * The Channels kit view's data-to-rows mapping (pure; pinned by channelsKitModel.test.ts).
 * Everything here RE-USES the current tab's own decisions: the verdict is commsVerdict, "needs
 * you" is isActionable, a receiver's state is receiverHealth, a section's is
 * sectionReceiverStatus, the search is matchesCommsQuery. What is new is only the kit's
 * vocabulary for them: which Mark a verdict wears and which rows a verdict chip keeps.
 */
import type { MarkKind } from "@/app/_components/kit/types.ts";
import type { BadgeTone } from "@/app/_components/Badge.tsx";
import { commsVerdict, type CommsVerdict } from "@/app/_lib/comms-view.ts";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels.ts";
import { displayRecipient, isActionable, matchesCommsQuery, type Message, type ReceiptLabels, type RefInfo } from "../channelsCommsHelpers.ts";
import { receiverHealth, sectionReceiverStatus, type ReceiverHealth, type ReceiverVerdict, type SectionReceiverStatus } from "../receiverHealth.ts";
import type { ChannelSectionId } from "../channelsSections.ts";

/** The chips, in the variant's order: the live states first, the dead ones last. */
export const VERDICT_ORDER: readonly CommsVerdict[] = ["queued", "sent", "recovered", "failed", "bounced", "orphaned"];

export const VERDICT_MARK: Record<CommsVerdict, MarkKind> = {
  sent: "ok",
  queued: "wait",
  failed: "fail",
  bounced: "bounce",
  recovered: "recovered",
  orphaned: "unknown",
};

export const RECEIVER_MARK: Record<ReceiverVerdict, MarkKind> = {
  waiting: "wait",
  reachedNoLeads: "caution",
  delivering: "ok",
  pullFailing: "fail",
};

export const TONE_MARK: Record<BadgeTone, MarkKind> = {
  positive: "ok",
  caution: "caution",
  critical: "fail",
  neutral: "wait",
  info: "wait",
};

/** A verdict chip, or "dead" (every row that needs you: isActionable, the dead-letter set). */
export type VerdictFilter = CommsVerdict | "dead" | null;

export type LedgerQuery = { verdict: VerdictFilter; q: string; nameOf: (m: Message) => string; subjectOf: (m: Message) => string | null; recipientOf: (m: Message) => string | null };

/** Dead letters first, then newest first: the current ledger's order (ChannelsCommsTable). */
export function sortLedger(messages: readonly Message[]): Message[] {
  return [...messages].sort((a, b) => {
    const aa = isActionable(a);
    const bb = isActionable(b);
    if (aa !== bb) return aa ? -1 : 1;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

export function filterLedger(messages: readonly Message[], query: LedgerQuery): Message[] {
  return sortLedger(messages).filter((m) => {
    if (query.verdict === "dead" && !isActionable(m)) return false;
    if (query.verdict && query.verdict !== "dead" && commsVerdict(m) !== query.verdict) return false;
    return matchesCommsQuery(query.nameOf(m), query.subjectOf(m), query.recipientOf(m), query.q);
  });
}

/** How many rows each verdict chip would keep (a chip with 0 is disabled, never hidden). */
export function verdictCounts(messages: readonly Message[]): Record<CommsVerdict, number> {
  const out = { queued: 0, sent: 0, recovered: 0, failed: 0, bounced: 0, orphaned: 0 };
  for (const m of messages) out[commsVerdict(m)] += 1;
  return out;
}

export function deadCount(messages: readonly Message[]): number {
  return messages.filter(isActionable).length;
}

/** The receivers a section manages: email -> "email", ads -> "boards" (channelsSections). */
export function receiversFor(webhooks: readonly ChannelWebhookRecord[] | null, channel: string | undefined): ChannelWebhookRecord[] | null {
  if (webhooks === null) return null;
  return channel ? webhooks.filter((w) => w.channel === channel) : [];
}

/** A receiver's row: the mark its health wears, and whether it needs you (a failing pull). */
export function receiverRow(w: ChannelWebhookRecord): {
  mark: MarkKind;
  needs: boolean;
  verdict: ReceiverVerdict;
  key: ReceiverHealth["key"];
  detail: string | null;
} {
  const h = receiverHealth(w);
  return { mark: RECEIVER_MARK[h.verdict], needs: h.verdict === "pullFailing", verdict: h.verdict, key: h.key, detail: h.detail };
}

/** The section switcher's mark, from the same facts the current tab's badge reads. */
export function sectionMark(
  id: ChannelSectionId,
  jobs: readonly unknown[] | null,
  webhooks: readonly ChannelWebhookRecord[] | null,
  channel: string | undefined,
): { mark: MarkKind; key: "statusLive" | "statusNothingPublished" | SectionReceiverStatus["key"] } | null {
  if (id === "comms") return null;
  if (id === "careers") {
    if (jobs === null) return null;
    return jobs.length > 0 ? { mark: "ok", key: "statusLive" } : { mark: "wait", key: "statusNothingPublished" };
  }
  const list = receiversFor(webhooks, channel);
  if (list === null) return null;
  const s = sectionReceiverStatus(list);
  return { mark: TONE_MARK[s.tone], key: s.key };
}

/** Sum a section's receiver traffic; null while the receivers are unread (never a fake 0). */
export function receiverTotals(list: readonly ChannelWebhookRecord[] | null): { received: number | null; leads: number | null } {
  if (list === null) return { received: null, leads: null };
  return {
    received: list.reduce((n, h) => n + (h.receivedCount ?? 0), 0),
    leads: list.reduce((n, h) => n + (h.acceptedCount ?? 0), 0),
  };
}

/** The first sentence of a localized paragraph: the setting row's one-line consequence. */
export function firstSentence(text: string): string {
  const m = /^.*?[.!?](?=\s|$)/.exec(text.trim());
  return m ? m[0] : text.trim();
}

/** The ledger's name and role cells: the current table's own expressions (CommsTable). */
export function ledgerRole(m: Message, refs: Record<string, RefInfo>): string | null {
  return m.ref ? refs[m.ref]?.jobTitle ?? null : null;
}
export function ledgerName(m: Message, refs: Record<string, RefInfo>, labels: ReceiptLabels): string {
  return (m.ref ? refs[m.ref]?.label : null) ?? displayRecipient(m, labels) ?? "—";
}

/** What the reading pane holds: a message, a receiver, or one of the two delivery editors. */
export type ChannelsSelection = { kind: "msg" | "hook" | "relay" | "edge"; key: string };

/** The ledger's time cell, as the variant set it: "Sep 25, 09:05" (24h), so it never wraps in
 *  the 124px time track. The reader's locale, the browser's zone (formatRecordedAt's rule). */
export function recordedShort(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

/** A kind code as words, sentence case ("schedule_invite" -> "Schedule invite"). */
export function humanKind(kind: string): string {
  const s = kind.replace(/[_-]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** The n-th sentence of a localized paragraph, or the paragraph when it has fewer. */
export function nthSentence(text: string, n: number): string {
  const parts = text.trim().match(/[^.!?]+[.!?]+(?=\s|$)/g);
  return parts && parts[n] ? parts[n].trim() : text.trim();
}
