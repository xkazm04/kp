import type { TracedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { CHANNEL_COMMS_GLYPH } from "@/app/_components/glyph/glyphs/channelCommsGlyph";
import { CHANNEL_CAREERS_GLYPH } from "@/app/_components/glyph/glyphs/channelCareersGlyph";
import { CHANNEL_EMAIL_GLYPH } from "@/app/_components/glyph/glyphs/channelEmailGlyph";
import { CHANNEL_ADS_GLYPH } from "@/app/_components/glyph/glyphs/channelAdsGlyph";
import type { ChannelSectionId } from "./channelsSections";

// The initial-state model behind the Intake brief empty state.
//
// Channels sits at the very top of the hiring chain, so the usual ChainEmptyState
// answer ("your data comes from the tab upstream") has nowhere to point: nothing
// upstream of a channel exists inside kp at all. What's missing is a CONNECTION to
// the outside world. So every pane's initial state is described here as a
// commissioning brief — what the channel promises, what it will prove once wired,
// and the concrete three-line setup contract for getting there.
//
// Honesty rule baked into the shape: `steps`/`effort` describe work NOT yet done,
// and `waiting` is the separate copy for "wired, but nothing has come through".
// A pane that is connected must never be shown the disconnected copy, and a pane
// that isn't connected must never read as live.
//
// Locale-free by construction (mirrors channelsSections.ts and
// analyticsFunnelEmptyState.ts): every field below is a `channels.empty.*`
// catalog KEY, never a sentence. `ChannelsEmpty` resolves them with its own `t`,
// so this module stays a pure data table and no English can settle in it.

/** The copy slots a channel's brief fills. */
export type ChannelEmptyField = "promise" | "proof" | "actionHint" | "step1" | "step2" | "step3" | "effort" | "waiting";

/** A key relative to the `channels.empty` namespace. */
export type ChannelEmptyKey = `${ChannelSectionId}.${ChannelEmptyField}`;

export type ChannelEmptySpec = {
  /** Traced /motionize glyph — the channel's identity. Not localizable. */
  glyph: TracedGlyph;
  /** Serif headline: the promise this channel keeps once it is wired. */
  promise: ChannelEmptyKey;
  /** What the operator will actually see after connecting it. */
  proof: ChannelEmptyKey;
  /** The concrete next action, phrased as the operator would say it. */
  actionHint: ChannelEmptyKey;
  /** The setup contract — three lines, no more. */
  steps: readonly [ChannelEmptyKey, ChannelEmptyKey, ChannelEmptyKey];
  /** Honest effort estimate for those three lines. */
  effort: ChannelEmptyKey;
  /** Copy for the connected-but-empty case. Never implies traffic that isn't there. */
  waiting: ChannelEmptyKey;
};

export const CHANNEL_EMPTY_SPECS: Record<ChannelSectionId, ChannelEmptySpec> = {
  comms: {
    glyph: CHANNEL_COMMS_GLYPH,
    promise: "comms.promise",
    proof: "comms.proof",
    actionHint: "comms.actionHint",
    steps: ["comms.step1", "comms.step2", "comms.step3"],
    effort: "comms.effort",
    waiting: "comms.waiting",
  },
  careers: {
    glyph: CHANNEL_CAREERS_GLYPH,
    promise: "careers.promise",
    proof: "careers.proof",
    actionHint: "careers.actionHint",
    steps: ["careers.step1", "careers.step2", "careers.step3"],
    effort: "careers.effort",
    waiting: "careers.waiting",
  },
  email: {
    glyph: CHANNEL_EMAIL_GLYPH,
    promise: "email.promise",
    proof: "email.proof",
    actionHint: "email.actionHint",
    steps: ["email.step1", "email.step2", "email.step3"],
    effort: "email.effort",
    waiting: "email.waiting",
  },
  ads: {
    glyph: CHANNEL_ADS_GLYPH,
    promise: "ads.promise",
    proof: "ads.proof",
    actionHint: "ads.actionHint",
    steps: ["ads.step1", "ads.step2", "ads.step3"],
    effort: "ads.effort",
    waiting: "ads.waiting",
  },
};
