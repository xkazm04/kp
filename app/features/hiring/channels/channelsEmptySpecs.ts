import type { LucideIcon } from "lucide-react";
import { AtSign, Globe, Megaphone, Radio, Send, Users } from "lucide-react";
import type { TracedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { CHANNEL_COMMS_GLYPH } from "@/app/_components/glyph/glyphs/channelCommsGlyph";
import { CHANNEL_CAREERS_GLYPH } from "@/app/_components/glyph/glyphs/channelCareersGlyph";
import { CHANNEL_EMAIL_GLYPH } from "@/app/_components/glyph/glyphs/channelEmailGlyph";
import { CHANNEL_ADS_GLYPH } from "@/app/_components/glyph/glyphs/channelAdsGlyph";
import type { ChannelSectionId } from "./channelsSections";

// The initial-state model shared by BOTH directional empty-state systems.
//
// Channels sits at the very top of the hiring chain, so the usual ChainEmptyState
// answer ("your data comes from the tab upstream") has nowhere to point: nothing
// upstream of a channel exists inside kp at all. What's missing is a CONNECTION to
// the outside world. So every pane's initial state is described here as a two-
// terminal circuit — a source, a destination, and which end isn't wired yet — plus
// the concrete setup contract for closing it. The two systems (`patchbay`, `brief`)
// are two readings of this one model, never two separate designs per pane.
//
// Honesty rule baked into the shape: `steps`/`effort` describe work NOT yet done,
// and `waiting` is the separate copy for "wired, but nothing has come through".
// A pane that is connected must never be shown the disconnected copy, and a pane
// that isn't connected must never read as live.

export type ChannelEmptySystem = "baseline" | "patchbay" | "brief";

export const EMPTY_SYSTEM_OPTIONS: ReadonlyArray<{ value: ChannelEmptySystem; label: string }> = [
  { value: "baseline", label: "Baseline" },
  { value: "patchbay", label: "Patch bay" },
  { value: "brief", label: "Intake brief" },
];

export type ChannelTerminal = { label: string; note: string; icon: LucideIcon };

export type ChannelEmptySpec = {
  /** Traced /motionize glyph — the channel's identity in both systems. */
  glyph: TracedGlyph;
  /** Serif headline: the promise this channel keeps once it is wired. */
  promise: string;
  /** What the operator will actually see after connecting it. */
  proof: string;
  source: ChannelTerminal;
  destination: ChannelTerminal;
  /** Which terminal is the one still missing while the channel is unconnected. */
  missingEnd: "source" | "destination";
  /** The concrete next action, phrased as the operator would say it. */
  actionHint: string;
  /** The setup contract — three lines, no more. */
  steps: string[];
  /** Honest effort estimate for those three lines. */
  effort: string;
  /** Copy for the connected-but-empty case. Never implies traffic that isn't there. */
  waiting: string;
};

export const CHANNEL_EMPTY_SPECS: Record<ChannelSectionId, ChannelEmptySpec> = {
  comms: {
    glyph: CHANNEL_COMMS_GLYPH,
    promise: "Every candidate message on one auditable record",
    proof: "Once the relay is set, each invite, rejection and reminder is logged here with the delivery result it actually got.",
    source: { label: "kp outbox", note: "Invites, rejections, reminders", icon: Send },
    destination: { label: "Candidate inboxes", note: "Reached through your relay endpoint", icon: Radio },
    missingEnd: "destination",
    actionHint: "Set the relay endpoint below",
    steps: [
      "Paste your delivery endpoint URL into the relay card below.",
      "Add a signing secret so a receiver can prove the call came from kp.",
      "Send the test ping and confirm it comes back green.",
    ],
    effort: "About 2 minutes — one endpoint serves the whole workspace",
    waiting: "The relay is set and nothing has been sent yet. Messages appear here the moment you act on a candidate.",
  },
  careers: {
    glyph: CHANNEL_CAREERS_GLYPH,
    promise: "One public apply link, embeddable anywhere",
    proof: "Publish a role and its apply link shows up here, ready to paste into a post, an email signature or your own site.",
    source: { label: "Your careers page", note: "One link per published role", icon: Globe },
    destination: { label: "Pipeline · Accepted", note: "Applicants arrive as candidate cards", icon: Users },
    missingEnd: "source",
    actionHint: "Publish a role to mint its link",
    steps: [
      "Draft or import a job description in the Library.",
      "Publish the role — publishing is what mints its public apply link.",
      "Copy that link into your post, your site or your email signature.",
    ],
    effort: "About a minute once a role exists",
    waiting: "The links are live and no one has applied yet. The first application lands straight in the pipeline.",
  },
  email: {
    glyph: CHANNEL_EMAIL_GLYPH,
    promise: "Applications forwarded straight out of your mailbox",
    proof: "Every email matching your rule becomes a candidate card with its CV attached — nobody re-types an application again.",
    source: { label: "Gmail / Outlook", note: "One forwarding rule per role", icon: AtSign },
    destination: { label: "Pipeline · Accepted", note: "Parsed into candidate cards", icon: Users },
    missingEnd: "source",
    actionHint: "Add a role inbox to get its address",
    steps: [
      "Add a role inbox — kp mints a parse address bound to that role.",
      "In Gmail or Outlook, forward matching mail to that address.",
      "Confirm the rule; the setup guide walks the exact steps per client.",
    ],
    effort: "About 3 minutes — one rule per role",
    waiting: "The rule is in place and nothing has been forwarded yet. The first application shows up in the pipeline.",
  },
  ads: {
    glyph: CHANNEL_ADS_GLYPH,
    promise: "Lead-gen ad forms file their own leads",
    proof: "A LinkedIn or Meta lead becomes a candidate card seconds after someone submits the ad form.",
    source: { label: "LinkedIn / Meta", note: "Lead-gen ad forms", icon: Megaphone },
    destination: { label: "Pipeline · Accepted", note: "Leads filed as candidates", icon: Users },
    missingEnd: "source",
    actionHint: "Add a receiver to get its webhook URL",
    steps: [
      "Add a receiver for the role you are advertising.",
      "In Zapier or Make, trigger a flow on a new lead from the ad form.",
      "POST that lead to the receiver URL kp hands you.",
    ],
    effort: "About 5 minutes — one receiver per advertised role",
    waiting: "The receiver is armed and no leads have arrived yet. The first one files itself into the pipeline.",
  },
};
