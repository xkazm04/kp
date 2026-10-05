/*
 * The Night Post's level machine (pure; pinned by channelsNightNav.test.ts).
 *
 * The surface is a STACK of levels, the root always the plumbing:
 *   L0 the plumbing (the district) · L1 one channel's setup · L2 the ledger · L3 one message.
 * A push opens a level over the current one, a pop returns, popTo is a breadcrumb click,
 * replaceTop is a sideways step (the next channel, the next message). The generic half (the
 * reducer's rules, how each layer is on screen) is the kit's level stack
 * (app/_components/kit/scene/levelStack.ts); this module is the Night Post's places and grammar.
 * Nothing here knows about React, the DOM or the URL object: the hook (useChannelsNightNav) owns those.
 *
 * The URL grammar is the one `?sec=` inbox the tab has always had (a one-shot arrival,
 * never state): `parseNightArrival` turns an arriving value into the stack it lands on and
 * `nightArrivalParam` is its inverse, for anything that builds a link into Channels.
 */
import { levelReduce, type LevelAction } from "@/app/_components/kit/scene/levelStack.ts";
import type { CommsVerdict } from "@/app/_lib/comms-view.ts";

/** The six things a level 1 can open, in the stepper's order (doors first, then delivery). */
export const NIGHT_CHANNELS = ["careers", "email", "ads", "feeds", "relay", "edge"] as const;
export type NightChannel = (typeof NIGHT_CHANNELS)[number];

export function isNightChannel(value: string | null | undefined): value is NightChannel {
  return value != null && (NIGHT_CHANNELS as readonly string[]).includes(value);
}

/** A ledger verdict filter: one verdict, "dead" (everything that needs you), or none. */
export type LedgerVerdict = CommsVerdict | "dead" | null;
const LEDGER_VERDICTS: readonly string[] = ["queued", "sent", "recovered", "failed", "bounced", "orphaned", "dead"];

export type NightEntry =
  | { level: 0 }
  /** `focus` is a receiver token the level opens on (a needs-you item, a deep link). */
  | { level: 1; channel: NightChannel; focus: string | null }
  /** `from` is the channel the ledger was opened from (its scope and its way back). */
  | { level: 2; verdict: LedgerVerdict; role: string | null; from: NightChannel | null }
  /** `list` is the ordered ids the message was opened from, for prev / next. */
  | { level: 3; id: string; list: readonly string[] };

export type NightLevel = NightEntry["level"];
export type NightStack = readonly NightEntry[];

export const NIGHT_ROOT: NightStack = [{ level: 0 }];
export const LEDGER_ALL: NightEntry = { level: 2, verdict: null, role: null, from: null };

export type NightAction = LevelAction<NightEntry>;

/** Two entries name the same place (the fields that make a level what it is). */
export function sameEntry(a: NightEntry, b: NightEntry): boolean {
  if (a.level !== b.level) return false;
  if (a.level === 1 && b.level === 1) return a.channel === b.channel;
  if (a.level === 2 && b.level === 2) return a.verdict === b.verdict && a.role === b.role;
  if (a.level === 3 && b.level === 3) return a.id === b.id;
  return true;
}

export function topOf(stack: NightStack): NightEntry {
  return stack[stack.length - 1] ?? NIGHT_ROOT[0];
}

export function depthOf(stack: NightStack): number {
  return Math.max(0, stack.length - 1);
}

/**
 * One transition, by the kit's rules: the root never leaves; a push of a place already on the stack
 * returns to it (relay -> ledger -> message -> "configure the relay" pops back to the relay instead
 * of stacking a second one); a sideways step keeps its level.
 */
export function nightReduce(stack: NightStack, action: NightAction): NightStack {
  return levelReduce(stack, action, { root: NIGHT_ROOT, same: sameEntry });
}

/** The channel that owns a level (for the building focus returns to, and the frame's ground). */
export function channelOf(entry: NightEntry): NightChannel | "book" | null {
  if (entry.level === 1) return entry.channel;
  if (entry.level === 2 || entry.level === 3) return "book";
  return null;
}

/** A sideways step through the six channels (wraps). */
export function stepChannel(channel: NightChannel, delta: 1 | -1): NightChannel {
  const i = NIGHT_CHANNELS.indexOf(channel);
  return NIGHT_CHANNELS[(i + delta + NIGHT_CHANNELS.length) % NIGHT_CHANNELS.length];
}

/** A sideways step through a message list; null at either end (no wrap: a ledger has an order). */
export function stepMessage(entry: Extract<NightEntry, { level: 3 }>, delta: 1 | -1): string | null {
  const i = entry.list.indexOf(entry.id);
  if (i < 0) return null;
  return entry.list[i + delta] ?? null;
}

/** A React key per layer: its depth and the place it shows (a swap to another place remounts). */
export function layerKey(entry: NightEntry, depth: number): string {
  if (entry.level === 1) return `${depth}:c:${entry.channel}`;
  if (entry.level === 2) return `${depth}:l`;
  if (entry.level === 3) return `${depth}:m:${entry.id}`;
  return "0";
}

/* ------------------------------------------------------------------ the URL inbox grammar */

/** The inbox param. It is the tab's historic `?sec=`, so every old link still lands. */
export const NIGHT_PARAM = "sec";

// Tokens and message ids are opaque; anything outside this set is not one of ours.
const KEY = /^[\w.-]{1,128}$/;

/**
 * `?sec=` -> the stack it lands on, or null (not ours: ignored, and the inbox still empties).
 *   comms | ledger            the ledger (L2)       `comms` is the old Communications section
 *   dead | <verdict>          the ledger, filtered  `dead` = everything that needs you
 *   <channel>[:<token>]       that channel (L1), opened on one receiver
 *   msg:<id>                  one message (L3) over the ledger
 *   plumbing                  the plumbing (L0)
 */
export function parseNightArrival(raw: string | null): NightStack | null {
  if (raw == null) return null;
  const value = raw.trim();
  if (!value) return null;
  const sep = value.indexOf(":");
  const head = (sep < 0 ? value : value.slice(0, sep)).toLowerCase();
  const key = sep < 0 ? null : value.slice(sep + 1);
  if (key !== null && !KEY.test(key)) return null;
  if (head === "plumbing" && key === null) return NIGHT_ROOT;
  if ((head === "comms" || head === "ledger") && key === null) return [NIGHT_ROOT[0], LEDGER_ALL];
  if (LEDGER_VERDICTS.includes(head) && key === null) {
    return [NIGHT_ROOT[0], { level: 2, verdict: head as LedgerVerdict, role: null, from: null }];
  }
  if (isNightChannel(head)) return [NIGHT_ROOT[0], { level: 1, channel: head, focus: key }];
  if (head === "msg" && key !== null) return [NIGHT_ROOT[0], LEDGER_ALL, { level: 3, id: key, list: [key] }];
  return null;
}

/** The inverse: the `?sec=` value that lands on this entry (the role scope is not addressable). */
export function nightArrivalParam(entry: NightEntry): string {
  if (entry.level === 1) return entry.focus ? `${entry.channel}:${entry.focus}` : entry.channel;
  if (entry.level === 2) return entry.verdict ?? "comms";
  if (entry.level === 3) return `msg:${entry.id}`;
  return "plumbing";
}
