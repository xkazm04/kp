import type { BadgeTone } from "@/app/_components/Badge";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";

// RECEIVER HEALTH — one verdict per receiver, and one roll-up per Channels section.
//
// A receiver used to be binary: Waiting, or Listening once any authenticated POST had
// arrived (isReceiverLive). That is CONNECTIVITY, not delivery: a Zapier test ping
// followed by a week of rejected payloads read green, and the pull half every row
// already carries (lastPullError) was shown nowhere. The candidate-communication-
// integrity standard separates configured / configured-but-unverified / verified, and
// only the last may be trusted. So:
//
//   · waiting         never reached, nothing filed                  neutral
//   · reachedNoLeads  reached (live) but no candidate filed yet     caution
//   · delivering      at least one candidate filed                  positive
//   · pullFailing     a pull source is set and its last pull failed critical
//
// pullFailing wins over everything: past leads say nothing about the source that
// stopped answering on Tuesday. The raw error (`HTTP 502`, pull-pass.ts machine text)
// is exposed as `detail` for a code-styled render, never as the headline sentence —
// the headline is always the catalog key.
//
// `live` keeps the ONE liveness definition (isReceiverLive in useChannelsReceivers),
// restated here rather than imported so this module stays free of the "use client"
// hook file.

export type ReceiverHealthInput = Pick<ChannelWebhookRecord, "receivedCount" | "acceptedCount"> &
  Partial<Pick<ChannelWebhookRecord, "firstReceivedAt" | "pullUrl" | "lastPullError">>;

export type ReceiverVerdict = "waiting" | "reachedNoLeads" | "delivering" | "pullFailing";

/** The `channels.*` catalog key that headlines each verdict. */
export const RECEIVER_VERDICT_KEY = {
  waiting: "statusWaiting",
  reachedNoLeads: "receivers.healthReachedNoLeads",
  delivering: "receivers.healthDelivering",
  pullFailing: "receivers.healthPullFailing",
} as const satisfies Record<ReceiverVerdict, string>;

const VERDICT_TONE: Record<ReceiverVerdict, BadgeTone> = {
  waiting: "neutral",
  reachedNoLeads: "caution",
  delivering: "positive",
  pullFailing: "critical",
};

export type ReceiverHealth = {
  verdict: ReceiverVerdict;
  tone: BadgeTone;
  key: (typeof RECEIVER_VERDICT_KEY)[ReceiverVerdict];
  /** Connectivity proven — the isReceiverLive definition. */
  live: boolean;
  /** The raw pull error, as DATA (render it code-styled), or null. */
  detail: string | null;
};

export function receiverHealth(h: ReceiverHealthInput): ReceiverHealth {
  const live = h.receivedCount > 0 || Boolean(h.firstReceivedAt);
  const pullError = h.pullUrl && h.lastPullError ? h.lastPullError : null;
  const verdict: ReceiverVerdict = pullError
    ? "pullFailing"
    : h.acceptedCount > 0
      ? "delivering"
      : live
        ? "reachedNoLeads"
        : "waiting";
  return { verdict, tone: VERDICT_TONE[verdict], key: RECEIVER_VERDICT_KEY[verdict], live, detail: pullError };
}

/** The section badge's vocabulary: the ChannelsTab statusFor states, extended by one
 *  caution state. Listening still means "a receiver was reached"; it is now withheld
 *  when any receiver in the section is reached-but-empty or failing its pull. */
export type SectionReceiverStatus = {
  tone: BadgeTone;
  key: "statusOff" | "statusConfigured" | "statusListening" | "statusNeedsAttention";
};

export function sectionReceiverStatus(hooks: readonly ReceiverHealthInput[]): SectionReceiverStatus {
  if (hooks.length === 0) return { tone: "neutral", key: "statusOff" };
  const verdicts = hooks.map(receiverHealth);
  if (verdicts.some((v) => v.verdict === "pullFailing" || v.verdict === "reachedNoLeads")) {
    return { tone: "caution", key: "statusNeedsAttention" };
  }
  return verdicts.some((v) => v.live) ? { tone: "positive", key: "statusListening" } : { tone: "info", key: "statusConfigured" };
}
