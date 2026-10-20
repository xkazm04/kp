/*
 * The ledger's rules (level 2, the post book): pure, pinned by channelsNightLedgerModel.test.ts.
 *
 * Moved here from the retired kit view's model (kit/channelsKitModel.ts) and grown by the Night
 * Post's own truths. Everything RE-USES the product's
 * decisions: the verdict is commsVerdict, "needs you" is isActionable, the search is
 * matchesCommsQuery, a door is resendDoorOf. What is new is only how the post book says them:
 *
 *   - the seven chips (needs you first) and the key each answers to (1-7);
 *   - chip counts over the rows the OTHER filters keep (the facets, the search, the scope);
 *   - a zero that was never measured is a dash: with no relay nothing is sent, so "0 failed"
 *     is not good news (`chipReading`);
 *   - the role scope a channel's "Open the ledger" carries (`scopeRoles`);
 *   - the book's condition for its drawing (`bookCondition`).
 */
import type { MarkKind } from "@/app/_components/kit/types.ts";
import type { Condition } from "@/app/_components/kit/scene/conditions.ts";
import { commsVerdict, type CommsVerdict } from "@/app/_lib/comms-view.ts";
import { displayRecipient, isActionable, matchesCommsQuery, type Message, type ReceiptLabels, type RefInfo } from "../../channelsCommsHelpers.ts";

/** The verdicts in the chips' order: the live states first, the dead ones last. */
export const VERDICT_ORDER: readonly CommsVerdict[] = ["queued", "sent", "recovered", "failed", "bounced", "orphaned"];

export const VERDICT_MARK: Record<CommsVerdict, MarkKind> = {
  sent: "ok",
  queued: "wait",
  failed: "fail",
  bounced: "bounce",
  recovered: "recovered",
  orphaned: "unknown",
};

/** A verdict chip, or "dead" (every row that needs you: isActionable, the dead-letter set). */
export type VerdictFilter = CommsVerdict | "dead" | null;
export type LedgerChip = CommsVerdict | "dead";

/** The seven chips in reading order; chip i answers to the key `i + 1`. */
export const LEDGER_CHIPS: readonly LedgerChip[] = ["dead", ...VERDICT_ORDER];

/** The chip a digit key toggles ("1" = needs you ... "7" = unmatched receipt), or null. */
export function chipForKey(key: string): LedgerChip | null {
  if (!/^[1-7]$/.test(key)) return null;
  return LEDGER_CHIPS[Number(key) - 1] ?? null;
}

/** A chip press: the same chip again clears the filter, another chip replaces it. */
export function toggleVerdict(current: VerdictFilter, chip: LedgerChip): VerdictFilter {
  return current === chip ? null : chip;
}

/** The ledger's three column facets: a role title, a channel code, a kind code ("" = all). */
export type LedgerFacets = { role: string; channel: string; kind: string };
export const NO_FACETS: LedgerFacets = { role: "", channel: "", kind: "" };

export type LedgerQuery = {
  verdict: VerdictFilter;
  q: string;
  nameOf: (m: Message) => string;
  subjectOf: (m: Message) => string | null;
  recipientOf: (m: Message) => string | null;
  /** The column facets (the retired table's Role / Channel / Type filters); "" or absent = all. */
  facets?: LedgerFacets;
  roleOf?: (m: Message) => string | null;
  /** The role titles a channel feeds (its "Open the ledger"); null = every message. */
  scope?: readonly string[] | null;
};

/** What each facet can be set to: only the values present in the loaded ledger, sorted by the
 *  reader's collation (a plain sort puts Č/Ř/Š/Ž after Z; the retired table's rule). */
export function ledgerFacetOptions(
  messages: readonly Message[],
  roleOf: (m: Message) => string | null,
  locale: string,
): { role: string[]; channel: string[]; kind: string[] } {
  const cmp = new Intl.Collator(locale).compare;
  const distinct = (pick: (m: Message) => string | null) =>
    [...new Set(messages.map(pick).filter((v): v is string => Boolean(v)))].sort(cmp);
  return { role: distinct(roleOf), channel: distinct((m) => m.channel), kind: distinct((m) => m.kind) };
}

/** Dead letters first, then newest first: the ledger's order since the first Comms table. */
export function sortLedger(messages: readonly Message[]): Message[] {
  return [...messages].sort((a, b) => {
    const aa = isActionable(a);
    const bb = isActionable(b);
    if (aa !== bb) return aa ? -1 : 1;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

/** Every filter but the verdict: the facets, the scope and the search. */
function keptByOthers(m: Message, query: LedgerQuery): boolean {
  const role = query.roleOf ? query.roleOf(m) : null;
  const f = query.facets;
  if (f?.role && role !== f.role) return false;
  if (f?.channel && m.channel !== f.channel) return false;
  if (f?.kind && m.kind !== f.kind) return false;
  if (query.scope && !(role !== null && query.scope.includes(role))) return false;
  return matchesCommsQuery(query.nameOf(m), query.subjectOf(m), query.recipientOf(m), query.q);
}

function keptByVerdict(m: Message, verdict: VerdictFilter): boolean {
  if (verdict === "dead") return isActionable(m);
  return !verdict || commsVerdict(m) === verdict;
}

export function filterLedger(messages: readonly Message[], query: LedgerQuery): Message[] {
  return sortLedger(messages).filter((m) => keptByVerdict(m, query.verdict) && keptByOthers(m, query));
}

/** How many rows each chip would keep, over what the other filters keep (a chip with 0 is
 *  disabled, never hidden). */
export function ledgerCounts(messages: readonly Message[], query: LedgerQuery): Record<LedgerChip, number> {
  const out: Record<LedgerChip, number> = { dead: 0, queued: 0, sent: 0, recovered: 0, failed: 0, bounced: 0, orphaned: 0 };
  for (const m of messages) {
    if (!keptByOthers(m, query)) continue;
    out[commsVerdict(m)] += 1;
    if (isActionable(m)) out.dead += 1;
  }
  return out;
}

/** The chips only a relay can fill: with none, nothing was sent, so nothing could fail,
 *  bounce, recover or come back unmatched. */
const RELAY_MEASURED: ReadonlySet<LedgerChip> = new Set<LedgerChip>(["dead", "recovered", "failed", "bounced", "orphaned"]);

/**
 * What a chip's count says. A zero on a chip only a relay can fill, while the relay is KNOWN to
 * be off, was never measured: it reads "—" with its reason, never a flattering 0. A real count
 * (older rows from a time a relay was wired) stays a count. `relayConfigured` null = not read.
 */
export function chipReading(chip: LedgerChip, count: number, relayConfigured: boolean | null): { count: number | null; notMeasured: boolean } {
  const notMeasured = relayConfigured === false && count === 0 && RELAY_MEASURED.has(chip);
  return { count: notMeasured ? null : count, notMeasured };
}

/** Which relay fact the post book opens with: none wired (the loudest thing on the level),
 *  a relay with queued rows (recorded, not sent), or nothing to say. */
export type RelayFact = { kind: "off"; queued: number } | { kind: "queued"; queued: number } | null;

export function relayFact(messages: readonly Message[] | null, relayConfigured: boolean): RelayFact {
  if (messages === null) return null;
  const queued = messages.filter((m) => commsVerdict(m) === "queued").length;
  if (!relayConfigured) return { kind: "off", queued };
  return queued > 0 ? { kind: "queued", queued } : null;
}

/** The facts `scopeRoles` reads from a receiver. */
export type ScopeReceiver = { channel: string; jobTitle: string | null; pullUrl: string | null };

/**
 * The role titles a channel feeds, the scope its "Open the ledger" opens with: careers = every
 * open role, email = the roles with an email receiver, ads = the roles with an ad-form receiver,
 * feeds = the roles whose receiver is pulled. null = no scope (the relay carries every message,
 * the edge sends none) or not readable yet (never a guess that hides rows).
 */
export function scopeRoles(
  from: string | null,
  receivers: readonly ScopeReceiver[] | null,
  jobs: readonly { title: string }[] | null,
): string[] | null {
  const titles = (list: readonly (string | null)[]) => [...new Set(list.filter((v): v is string => Boolean(v)))];
  if (from === "careers") return jobs ? titles(jobs.map((j) => j.title)) : null;
  if (!receivers) return null;
  if (from === "email") return titles(receivers.filter((r) => r.channel === "email").map((r) => r.jobTitle));
  if (from === "ads") return titles(receivers.filter((r) => r.channel === "boards").map((r) => r.jobTitle));
  if (from === "feeds") return titles(receivers.filter((r) => r.pullUrl).map((r) => r.jobTitle));
  return null;
}

/** The post book's drawing: unread is unknown; mail that is not leaving, or letters that need
 *  you, is failing; a sent row is the evidence for live; anything else waits. */
export function bookCondition(messages: readonly Message[] | null, relayConfigured: boolean): Condition {
  if (messages === null) return "unknown";
  if (messages.some(isActionable)) return "fail";
  const queued = messages.some((m) => commsVerdict(m) === "queued");
  if (!relayConfigured && queued) return "fail";
  return messages.some((m) => { const v = commsVerdict(m); return v === "sent" || v === "recovered"; }) ? "live" : "wait";
}

/** The ledger's name and role cells: the ref's candidate first, the recipient as a fallback. */
export function ledgerRole(m: Message, refs: Record<string, RefInfo>): string | null {
  return m.ref ? refs[m.ref]?.jobTitle ?? null : null;
}
export function ledgerName(m: Message, refs: Record<string, RefInfo>, labels: ReceiptLabels): string {
  return (m.ref ? refs[m.ref]?.label : null) ?? displayRecipient(m, labels) ?? "—";
}

/** The ledger's time cell: "Sep 25, 09:05" (24h), so it never wraps in the 124px time track.
 *  The reader's locale, the browser's zone (formatRecordedAt's rule). */
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
