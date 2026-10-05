/*
 * Level 1's receivers, feeds and credentials, as facts (pure; pinned by setupModel.test.ts).
 *
 * A receiver's endpoint IS a credential: anyone holding `/api/channels/inbound/<token>` (or
 * `<token>@<domain>`) can file applications into the pipeline. So the setup shows it masked until
 * the reader reveals it, and the copy action always copies the real value. Health comes from
 * receiverHealth (the tab's one verdict), never restated here; this module only ORDERS by it,
 * worst first, the way the plumbing ranks what needs a person.
 */
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels.ts";
import { receiverHealth, type ReceiverVerdict } from "../../receiverHealth.ts";

/* ------------------------------------------------------------------ credentials */

/** The dots a masked value shows in place of what it hides (never a count of the real length). */
export const MASK = "••••••";

/** A token with its middle hidden: the head names which receiver it is, the tail tells two apart.
 *  A short token shows nothing at all (two visible ends would be most of it). */
export function maskToken(token: string): string {
  if (token.length < 12) return MASK;
  const head = Math.min(7, Math.floor(token.length / 4));
  return `${token.slice(0, head)}${MASK}${token.slice(-2)}`;
}

/** `text` with every occurrence of `token` masked (an endpoint URL, an address). */
export function maskIn(text: string, token: string): string {
  return token ? text.split(token).join(maskToken(token)) : text;
}

export type ReceiverSection = "email" | "ads";

export type Endpoint = {
  /** What the source is pointed at: `<token>@<domain>` for wired email, else the HTTP receiver. */
  value: string;
  masked: string;
  /** The HTTP receiver (what reaches the studio today, whatever the section). */
  http: string;
  httpMasked: string;
  /** Email forwarding needs an inbound domain; an ad form always posts to the HTTP receiver. */
  wired: boolean;
};

export function receiverEndpoint(token: string, section: ReceiverSection, domain: string | null, base: string): Endpoint {
  const http = `${base}/api/channels/inbound/${token}`;
  const value = section === "email" && domain ? `${token}@${domain}` : http;
  return { value, masked: maskIn(value, token), http, httpMasked: maskIn(http, token), wired: section === "ads" || Boolean(domain) };
}

/** A signing secret made here (a relay's): 32 hex characters from the platform's CSPRNG. It is shown
 *  once, in the field, until the save; the server never returns a stored secret. */
export function generateSecret(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `whsec_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/* ------------------------------------------------------------------ receivers, worst first */

type Named = Pick<ChannelWebhookRecord, "token" | "jobId" | "jobTitle">;
type Healthy = Named & Pick<ChannelWebhookRecord, "receivedCount" | "acceptedCount" | "firstReceivedAt" | "pullUrl" | "lastPullError">;

/** Failing first, then reached-but-empty, then waiting for a first lead, then delivering. */
export const HEALTH_RANK: Record<ReceiverVerdict, number> = { pullFailing: 0, reachedNoLeads: 1, waiting: 2, delivering: 3 };

const nameOf = (w: Named) => w.jobTitle ?? w.jobId;

/** The section's receivers in the order a person should read them: worst health first, then the
 *  role name in the reader's collation (a plain sort puts Č after Z). Stable for equal names. */
export function rankReceivers<T extends Healthy>(list: readonly T[], locale: string): T[] {
  const cmp = new Intl.Collator(locale).compare;
  return [...list].sort((a, b) => HEALTH_RANK[receiverHealth(a).verdict] - HEALTH_RANK[receiverHealth(b).verdict] || cmp(nameOf(a), nameOf(b)));
}

/* ------------------------------------------------------------------ pull feeds */

/** A receiver's pull half: off (push only), wait (a source, never pulled), live, fail (last pull failed). */
export type FeedState = "fail" | "wait" | "live" | "off";

export function feedState(w: Pick<ChannelWebhookRecord, "pullUrl" | "lastPullAt" | "lastPullError">): FeedState {
  if (!w.pullUrl) return "off";
  if (w.lastPullError) return "fail";
  return w.lastPullAt ? "live" : "wait";
}

const FEED_RANK: Record<FeedState, number> = { fail: 0, wait: 1, live: 2, off: 3 };

/** Every receiver that could pull, failing first, then set-but-never-pulled, pulling, push only. */
export function rankFeeds<T extends Named & Pick<ChannelWebhookRecord, "pullUrl" | "lastPullAt" | "lastPullError">>(list: readonly T[], locale: string): T[] {
  const cmp = new Intl.Collator(locale).compare;
  return [...list].sort((a, b) => FEED_RANK[feedState(a)] - FEED_RANK[feedState(b)] || cmp(nameOf(a), nameOf(b)));
}

/** The words of a feed's state (full catalog paths; tsc checks them at the call site). */
export const FEED_STATE_KEY = {
  fail: "channels.pull.statusFailing",
  wait: "channelsNight.plumbing.chip.notPulled",
  live: "channels.pull.statusOn",
  off: "channels.pull.statusOff",
} as const satisfies Record<FeedState, string>;

/** The condition a feed wears (the kit's vocabulary: a push-only receiver is not set up to pull). */
export const FEED_CONDITION = { fail: "fail", wait: "wait", live: "live", off: "off" } as const satisfies Record<FeedState, string>;

/** The condition a receiver's health wears. */
export const RECEIVER_CONDITION = {
  pullFailing: "fail",
  reachedNoLeads: "reach",
  waiting: "wait",
  delivering: "live",
} as const satisfies Record<ReceiverVerdict, string>;
