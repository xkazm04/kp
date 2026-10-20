/*
 * The plumbing, as facts (pure; pinned by channelsNightPlumbing.test.ts against the contest's
 * fresh / partial / live sample states).
 *
 * Level 0 draws the district from REAL state: the open roles, the receivers, the loaded ledger
 * window, the relay's health word and the edge's drain ledger. This module decides what each
 * building SAYS (its condition, a chip, one fact), the three head figures, and what needs a
 * person, worst first. It re-uses the tab's own decisions, never restates them: a verdict is
 * commsVerdict, "needs you" is isActionable, a receiver's health is receiverHealth.
 *
 * The vocabulary never flattens (docs/features/comms/README.md §2, §11):
 *   off      not configured                      dashed
 *   wait     configured, nothing yet / not pulled yet / never drained / nothing sent yet
 *   reach    received, none filed                caution
 *   fail     pull failing / secret unreadable / drain failing    red
 *   live     proven by evidence (a lead filed, a message sent, a drain done)
 *   unknown  not read (in flight, failed, denied): never a guess
 * Words live in the catalog (`channelsNight.plumbing.*`); this module returns keys and numbers.
 */
import { commsVerdict } from "@/app/_lib/comms-view.ts";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels.ts";
import type { EdgeErrorKind } from "@/app/_lib/edge-config.ts";
import { isActionable, type Message } from "../channelsCommsHelpers.ts";
import { receiverHealth } from "../receiverHealth.ts";
import type { EdgeState, RelayHealthWord } from "./channelsNightReads.ts";
import type { LedgerVerdict, NightChannel, NightEntry } from "./channelsNightNav.ts";

export type NightCondition = "live" | "wait" | "reach" | "fail" | "off" | "unknown";
/** A building on the district: the six channels, the post book and the studio. */
export type NightNode = NightChannel | "book" | "studio";

export type ReceiverFacts = Pick<
  ChannelWebhookRecord,
  "token" | "channel" | "jobId" | "jobTitle" | "receivedCount" | "acceptedCount" | "firstReceivedAt" | "pullUrl" | "lastPullAt" | "lastPullError"
>;

export type PlumbingInput = {
  /** Open roles (openOnly); null = not read. */
  jobs: readonly { id: string }[] | null;
  receivers: readonly ReceiverFacts[] | null;
  receiversTruncated: boolean;
  /** Candidates waiting at the board's entry column (/api/attention). */
  waiting: number | null;
  /** The loaded ledger window; null = not read. */
  messages: readonly Message[] | null;
  /** Older rows exist beyond the loaded window (hasMore or truncated). */
  olderExist: boolean;
  relay: RelayHealthWord | null;
  edge: EdgeState | null;
  /** Every source's first read finished (ok or not). Until then nothing is claimed. */
  settled: boolean;
};

/* ------------------------------------------------------------------ the ledger, counted */

export type VerdictCounts = {
  queued: number; sent: number; recovered: number; failed: number; bounced: number; orphaned: number;
  total: number;
  /** Sent through a relay: sent + recovered. */
  delivered: number;
  /** Failed or bounced AND a door is open (isActionable minus the unmatched receipts). */
  needs: number;
  needsFailed: number;
  needsBounced: number;
  /** isActionable: the ledger's dead-letter set (needs + unmatched receipts). */
  dead: number;
};

export function countVerdicts(messages: readonly Message[]): VerdictCounts {
  const c: VerdictCounts = { queued: 0, sent: 0, recovered: 0, failed: 0, bounced: 0, orphaned: 0, total: 0, delivered: 0, needs: 0, needsFailed: 0, needsBounced: 0, dead: 0 };
  for (const m of messages) {
    const v = commsVerdict(m);
    c[v] += 1;
    c.total += 1;
    if (!isActionable(m)) continue;
    c.dead += 1;
    if (v === "failed") c.needsFailed += 1;
    if (v === "bounced") c.needsBounced += 1;
  }
  c.delivered = c.sent + c.recovered;
  c.needs = c.needsFailed + c.needsBounced;
  return c;
}

/** Is a relay delivering? null = not known yet (never read as "no"). */
export function relayOn(relay: RelayHealthWord | null): boolean | null {
  if (relay === null) return null;
  return relay === "env" || relay === "configured";
}

/* ------------------------------------------------------------------ the buildings */

export type PlateChip =
  | "published" | "nothingPublished" | "notSetUp" | "delivering" | "waiting" | "reachedNoLeads" | "pullFailing"
  | "pushOnly" | "notPulled" | "pulling" | "relayNotConfigured" | "relayNotSending" | "relayNothingSent" | "relayUnreadable"
  | "edgeNotPaired" | "edgeOffline" | "edgeSecretMissing" | "edgeNeverDrained" | "edgeFailing" | "edgePaired"
  | "bookNeedsYou" | "bookNoneSent" | "bookClear" | "bookEmpty" | "notRead";

export type PlateFact =
  | "careersRoles" | "careersNone"
  | "emailNone" | "adsNone" | "receiversNothing" | "receiversTraffic"
  | "feedsNone" | "feedsFailing" | "feedsNotPulled" | "feedsPulling"
  | "relayQueuedNotSent" | "relayNothingDeliverable" | "relayTraffic" | "relayNoSendYet" | "relayOutboxOnly"
  | "edgeNobody" | "edgeOfflineFact" | "edgeSecretFact" | "edgeNeverDrainedFact" | "edgeBeat" | "edgeNoBeat"
  | "bookNoneSentFact" | "bookTraffic" | "bookEmptyFact";

export type Backlog = "waiting" | "clear" | "unknown";

export type Plate = {
  node: NightNode;
  condition: NightCondition;
  /** The one plate on the district that must be read first (the loudest object). */
  alert: boolean;
  chip: PlateChip;
  fact: PlateFact | null;
  /** Numbers the chip / fact interpolate. */
  n: Record<string, number>;
  /** An ISO time the fact renders relatively (last pull, last beat). */
  when: string | null;
  backlog?: Backlog;
  failKind?: EdgeErrorKind;
  /** Older ledger rows exist beyond the loaded window: the book's numbers are the newest page. */
  partial?: boolean;
  sealed?: boolean;
};

const UNREAD = (node: NightNode): Plate => ({ node, condition: "unknown", alert: false, chip: "notRead", fact: null, n: {}, when: null });

const recvKey = (door: "email" | "ads") => (door === "email" ? "email" : "boards");

function receiverDoor(door: "email" | "ads", receivers: readonly ReceiverFacts[]): Plate {
  const list = receivers.filter((r) => r.channel === recvKey(door));
  const base = { node: door, alert: false, when: null } as const;
  if (list.length === 0) return { ...base, condition: "off", chip: "notSetUp", fact: door === "email" ? "emailNone" : "adsNone", n: {} };
  const health = list.map((r) => receiverHealth(r).verdict);
  const count = (v: string) => health.filter((h) => h === v).length;
  const received = list.reduce((a, r) => a + r.receivedCount, 0);
  const filed = list.reduce((a, r) => a + r.acceptedCount, 0);
  const n = { count: list.length, received, filed, failing: count("pullFailing"), reach: count("reachedNoLeads") };
  const fact: PlateFact = received === 0 ? "receiversNothing" : "receiversTraffic";
  if (n.failing) return { ...base, condition: "fail", chip: "pullFailing", fact, n };
  if (count("delivering")) return { ...base, condition: "live", chip: "delivering", fact, n };
  if (n.reach) return { ...base, condition: "reach", chip: "reachedNoLeads", fact, n };
  return { ...base, condition: "wait", chip: "waiting", fact, n };
}

function feedsDoor(receivers: readonly ReceiverFacts[]): Plate {
  const feeds = receivers.filter((r) => r.pullUrl);
  const base = { node: "feeds", alert: false } as const;
  if (feeds.length === 0) return { ...base, condition: "off", chip: "pushOnly", fact: "feedsNone", n: {}, when: null };
  const failing = feeds.filter((r) => r.lastPullError).length;
  const last = feeds.reduce<string | null>((a, r) => (r.lastPullAt && (!a || Date.parse(r.lastPullAt) > Date.parse(a)) ? r.lastPullAt : a), null);
  const n = { count: feeds.length, failing };
  if (failing) return { ...base, condition: "fail", chip: "pullFailing", fact: "feedsFailing", n, when: last };
  if (!last) return { ...base, condition: "wait", chip: "notPulled", fact: "feedsNotPulled", n, when: null };
  return { ...base, condition: "live", chip: "pulling", fact: "feedsPulling", n, when: last };
}

function relayDoor(relay: RelayHealthWord | null, c: VerdictCounts | null): Plate {
  if (relay === null) return UNREAD("relay");
  const base = { node: "relay", when: null } as const;
  const queued = c?.queued ?? 0;
  if (relay === "unreadable") return { ...base, condition: "fail", alert: queued > 0, chip: "relayUnreadable", fact: "relayOutboxOnly", n: { queued } };
  if (relay === "unconfigured") {
    return queued > 0
      ? { ...base, condition: "off", alert: true, chip: "relayNotSending", fact: "relayQueuedNotSent", n: { queued } }
      : { ...base, condition: "off", alert: false, chip: "relayNotConfigured", fact: "relayNothingDeliverable", n: {} };
  }
  // Configured (stored or env). "Delivering" is a claim that needs evidence: a sent row.
  if (!c || c.delivered === 0) return { ...base, condition: "wait", alert: false, chip: "relayNothingSent", fact: "relayNoSendYet", n: { queued } };
  return { ...base, condition: "live", alert: false, chip: "delivering", fact: "relayTraffic", n: { sent: c.delivered, needs: c.needs, queued } };
}

function edgeDoor(edge: EdgeState | null): Plate {
  if (edge === null) return UNREAD("edge");
  const base = { node: "edge", alert: false, sealed: edge.sealed } as const;
  const paired = edge.envConfigured || edge.url.trim() !== "";
  if (edge.offline) return { ...base, condition: "off", chip: "edgeOffline", fact: "edgeOfflineFact", n: {}, when: null };
  if (!paired) return { ...base, condition: "off", chip: "edgeNotPaired", fact: "edgeNobody", n: {}, when: null };
  if (!edge.hasSecret) return { ...base, condition: "wait", chip: "edgeSecretMissing", fact: "edgeSecretFact", n: {}, when: null };
  const backlog: Backlog = edge.pending === null ? "unknown" : edge.pending > 0 ? "waiting" : "clear";
  const n = { pending: edge.pending ?? 0 };
  if (edge.lastErrorKind) return { ...base, condition: "fail", chip: "edgeFailing", fact: edge.lastHeartbeatAt ? "edgeBeat" : "edgeNoBeat", n, when: edge.lastHeartbeatAt, backlog, failKind: edge.lastErrorKind };
  if (!edge.lastDrainAt) return { ...base, condition: "wait", chip: "edgeNeverDrained", fact: "edgeNeverDrainedFact", n, when: null, backlog };
  return { ...base, condition: "live", chip: "edgePaired", fact: edge.lastHeartbeatAt ? "edgeBeat" : "edgeNoBeat", n, when: edge.lastHeartbeatAt, backlog };
}

function bookPlate(c: VerdictCounts | null, on: boolean | null, partial: boolean): Plate {
  if (c === null) return UNREAD("book");
  const base = { node: "book", when: null, partial } as const;
  const n = { total: c.total, sent: c.delivered, needs: c.needs, orphaned: c.orphaned };
  if (c.total === 0) return { ...base, condition: "wait", alert: false, chip: "bookEmpty", fact: "bookEmptyFact", n };
  if (c.needs > 0) return { ...base, condition: "fail", alert: false, chip: "bookNeedsYou", fact: "bookTraffic", n };
  if (on === false && c.delivered === 0) return { ...base, condition: "off", alert: c.queued > 0, chip: "bookNoneSent", fact: "bookNoneSentFact", n };
  return { ...base, condition: "live", alert: false, chip: "bookClear", fact: "bookTraffic", n };
}

/**
 * Every building's plate, from the facts. A source not read yet is `unknown`, never empty.
 * The alarm is ONE plate: a plate that could alarm (the relay not sending queued mail, the ledger
 * holding it) keeps the treatment only while its building owns the top-ranked need (`needs[0]`,
 * worst first); any other keeps its plain condition mark.
 */
export function plumbingPlates(input: PlumbingInput, needs: readonly NeedItem[] = rankNeeds(input)): Record<Exclude<NightNode, "studio">, Plate> {
  const plates = rawPlates(input);
  const top = needs[0];
  const loud = top && top.sev >= NEEDS_SHOWN ? top.node : null;
  for (const p of Object.values(plates)) if (p.alert && p.node !== loud) p.alert = false;
  return plates;
}

function rawPlates(input: PlumbingInput): Record<Exclude<NightNode, "studio">, Plate> {
  const c = input.messages ? countVerdicts(input.messages) : null;
  const jobs = input.jobs;
  const rs = input.receivers;
  return {
    careers:
      jobs === null
        ? UNREAD("careers")
        : jobs.length > 0
          ? { node: "careers", condition: "live", alert: false, chip: "published", fact: "careersRoles", n: { count: jobs.length }, when: null }
          : { node: "careers", condition: "off", alert: false, chip: "nothingPublished", fact: "careersNone", n: {}, when: null },
    email: rs === null ? UNREAD("email") : receiverDoor("email", rs),
    ads: rs === null ? UNREAD("ads") : receiverDoor("ads", rs),
    feeds: rs === null ? UNREAD("feeds") : feedsDoor(rs),
    relay: relayDoor(input.relay, c),
    edge: edgeDoor(input.edge),
    book: bookPlate(c, relayOn(input.relay), input.olderExist),
  };
}

/* ------------------------------------------------------------------ the head figures */

export type NightFigure = {
  key: "waiting" | "messages" | "dead";
  value: number | null;
  /** Why the value is absent (a catalog key under figures.*), or a note under it. */
  reason: "notRead" | "notMeasured" | null;
  sent?: number;
  olderExist?: boolean;
  needs?: boolean;
};

export function plumbingFigures(input: PlumbingInput): NightFigure[] {
  const c = input.messages ? countVerdicts(input.messages) : null;
  const on = relayOn(input.relay);
  // A zero is good news only when it was measured: with no relay nothing is sent, so "0
  // dead letters" would flatter. It is a dash with its reason until a letter could die.
  const deadMeasured = c !== null && (on === true || c.dead > 0);
  return [
    { key: "waiting", value: input.waiting, reason: input.waiting === null ? "notRead" : null },
    { key: "messages", value: c ? c.total : null, reason: c ? null : "notRead", sent: c?.delivered, olderExist: input.olderExist },
    {
      key: "dead",
      value: deadMeasured ? c.dead : null,
      reason: deadMeasured ? null : c === null || on === null ? "notRead" : "notMeasured",
      needs: (c?.dead ?? 0) > 0,
    },
  ];
}

/* ------------------------------------------------------------------ what needs a person, worst first */

export type NeedKey =
  | "relayOffQueued" | "relayUnreadable" | "dead" | "pullFailing" | "edgeFailing" | "edgeSecretMissing" | "relayOff"
  | "orphaned" | "reachedNoLeads" | "queuedWithRelay" | "edgeOff" | "edgePending" | "nothingPublished" | "receiverWaiting";

export type NeedItem = {
  id: string;
  key: NeedKey;
  /** 0..100; >= NEEDS_SHOWN is listed and may take the headline. */
  sev: number;
  tone: "bad" | "warn" | "info";
  /** The building it belongs to (where the "start here" note pins). */
  node: NightNode;
  /** The level it opens. */
  target: NightEntry;
  n: Record<string, number>;
  /** A role title the sentence names, or null. */
  role: string | null;
  failKind?: EdgeErrorKind;
};

/** Items at or above this severity are listed ("needs you"); below it they are quiet. */
export const NEEDS_SHOWN = 30;

const toChannel = (r: ReceiverFacts): NightChannel => (r.channel === "email" ? "email" : "ads");

export function rankNeeds(input: PlumbingInput): NeedItem[] {
  const out: NeedItem[] = [];
  const add = (item: Omit<NeedItem, "n" | "role"> & { n?: Record<string, number>; role?: string | null }) =>
    out.push({ n: {}, role: null, ...item });
  const c = input.messages ? countVerdicts(input.messages) : null;
  const on = relayOn(input.relay);
  const relayTarget: NightEntry = { level: 1, channel: "relay", focus: null };
  const ledger = (verdict: LedgerVerdict): NightEntry => ({ level: 2, verdict, role: null, from: null });

  if (input.relay === "unreadable") add({ id: "relay-unreadable", key: "relayUnreadable", sev: 95, tone: "bad", node: "relay", target: relayTarget, n: { queued: c?.queued ?? 0 } });
  else if (on === false && c && c.queued > 0) add({ id: "relay-off", key: "relayOffQueued", sev: 100, tone: "bad", node: "relay", target: relayTarget, n: { count: c.queued } });
  else if (on === false) add({ id: "relay-off", key: "relayOff", sev: 60, tone: "warn", node: "relay", target: relayTarget });

  if (c && c.needs > 0) {
    add({ id: "dead", key: "dead", sev: 90 + Math.min(c.needs, 9) / 10, tone: "bad", node: "book", target: ledger("dead"), n: { count: c.needs, failed: c.needsFailed, bounced: c.needsBounced } });
  }
  for (const r of input.receivers ?? []) {
    if (r.pullUrl && r.lastPullError) {
      add({ id: `pull-${r.token}`, key: "pullFailing", sev: 85, tone: "bad", node: "feeds", target: { level: 1, channel: "feeds", focus: r.token }, role: r.jobTitle ?? r.jobId });
    }
  }
  const edge = input.edge;
  const edgeTarget: NightEntry = { level: 1, channel: "edge", focus: null };
  const edgePaired = edge ? edge.envConfigured || edge.url.trim() !== "" : false;
  if (edge && !edge.offline && edgePaired && edge.hasSecret && edge.lastErrorKind) {
    add({ id: "edge-failing", key: "edgeFailing", sev: 80, tone: "bad", node: "edge", target: edgeTarget, failKind: edge.lastErrorKind });
  }
  if (edge && !edge.offline && edgePaired && !edge.hasSecret) add({ id: "edge-secret", key: "edgeSecretMissing", sev: 70, tone: "warn", node: "edge", target: edgeTarget });
  if (c && c.orphaned > 0) add({ id: "orphaned", key: "orphaned", sev: 55, tone: "warn", node: "book", target: ledger("orphaned"), n: { count: c.orphaned } });
  for (const r of input.receivers ?? []) {
    const h = receiverHealth(r).verdict;
    if (h === "reachedNoLeads") {
      add({ id: `reach-${r.token}`, key: "reachedNoLeads", sev: 50, tone: "warn", node: toChannel(r), target: { level: 1, channel: toChannel(r), focus: r.token }, n: { count: r.receivedCount }, role: r.jobTitle ?? r.jobId });
    }
  }
  if (on === true && c && c.queued > 0) add({ id: "queued", key: "queuedWithRelay", sev: 45, tone: "warn", node: "book", target: ledger("queued"), n: { count: c.queued } });
  if (edge && !edge.offline && !edgePaired) add({ id: "edge-off", key: "edgeOff", sev: 35, tone: "warn", node: "edge", target: edgeTarget });
  else if (edge && edgePaired && edge.hasSecret && !edge.lastErrorKind && (edge.pending ?? 0) > 0) {
    add({ id: "edge-pending", key: "edgePending", sev: 30, tone: "info", node: "edge", target: edgeTarget, n: { count: edge.pending ?? 0 } });
  }
  if (input.jobs && input.jobs.length === 0) add({ id: "no-roles", key: "nothingPublished", sev: 25, tone: "info", node: "careers", target: { level: 1, channel: "careers", focus: null } });
  for (const r of input.receivers ?? []) {
    if (receiverHealth(r).verdict === "waiting") {
      add({ id: `wait-${r.token}`, key: "receiverWaiting", sev: 20, tone: "info", node: toChannel(r), target: { level: 1, channel: toChannel(r), focus: r.token }, role: r.jobTitle ?? r.jobId });
    }
  }
  // Stable: equal severities keep the order they were found in.
  return out.map((item, i) => ({ item, i })).sort((a, b) => b.item.sev - a.item.sev || a.i - b.i).map((x) => x.item);
}

/* ------------------------------------------------------------------ the sentence the page opens with */

export type Headline =
  | { kind: "reading" }
  | { kind: "need"; need: NeedItem }
  /** Everything was read, nothing needs you, every channel is set up and the relay has PROVEN it
   *  delivers (a sent row): the one state that may say "wired and flowing". */
  | { kind: "ok" }
  /** Everything was read and nothing needs you, but that is not proof it flows: the relay has not
   *  sent anything yet, and/or `off` channels are switched off or not set up. Calm, never green. */
  | { kind: "quiet"; relayProven: boolean; off: number }
  /** Nothing that COULD be read needs you, but some part was not read (denied, failed). */
  | { kind: "okPartial" };

/** The channels the "doors are open" claim covers (the studio and the ledger are not doors). */
const CHANNEL_NODES = ["careers", "email", "ads", "feeds", "relay", "edge"] as const;

export function plumbingHeadline(input: PlumbingInput, needs: readonly NeedItem[], plates: ReturnType<typeof plumbingPlates> = plumbingPlates(input, needs)): Headline {
  const top = needs[0];
  if (top && top.sev >= NEEDS_SHOWN) return { kind: "need", need: top };
  if (!input.settled) return { kind: "reading" };
  const allRead = input.jobs !== null && input.receivers !== null && input.messages !== null && input.relay !== null && input.edge !== null && input.waiting !== null;
  if (!allRead) return { kind: "okPartial" };
  // "The relay delivers" needs the evidence the relay plate needs for "Delivering": a sent row.
  const relayProven = plates.relay.condition === "live";
  const off = CHANNEL_NODES.filter((n) => plates[n].condition === "off").length;
  return relayProven && off === 0 ? { kind: "ok" } : { kind: "quiet", relayProven, off };
}

/* ------------------------------------------------------------------ everything level 0 draws, at once */

export type PlumbingModel = {
  plates: ReturnType<typeof plumbingPlates>;
  needs: NeedItem[];
  figures: NightFigure[];
  headline: Headline;
  /** Messages recorded and not sent (the pile behind the barrier). */
  queued: number;
  /** A relay is configured (the barrier is up); `plates.relay` says whether it is proven. */
  relayOpen: boolean;
};

export function plumbingModel(input: PlumbingInput): PlumbingModel {
  const needs = rankNeeds(input);
  const plates = plumbingPlates(input, needs);
  return {
    plates,
    needs,
    figures: plumbingFigures(input),
    headline: plumbingHeadline(input, needs, plates),
    queued: input.messages ? countVerdicts(input.messages).queued : 0,
    relayOpen: relayOn(input.relay) === true,
  };
}
