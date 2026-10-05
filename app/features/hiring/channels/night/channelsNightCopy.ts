/*
 * Which catalog key says what (pure data). The model (channelsNightPlumbing.ts) speaks in keys;
 * this map turns a key into a full next-intl path, re-using the tab's already-translated
 * `channels.*` words wherever the wording is the same and `channelsNight.*` only for new words.
 * Every value is a literal, so a typo is a tsc error at the call site (typed catalog keys).
 */
import type { NightChannel } from "./channelsNightNav.ts";
import type { NightNode, PlateChip } from "./channelsNightPlumbing.ts";

export const NODE_NAME = {
  careers: "channels.sections.careers.label",
  email: "channels.sections.email.label",
  ads: "channels.sections.ads.label",
  feeds: "channelsNight.shell.feedsName",
  relay: "channels.relay.title",
  edge: "channels.edge.title",
  book: "channelsNight.plumbing.ledgerName",
  studio: "channelsNight.plumbing.studio",
} as const satisfies Record<NightNode, string>;

export const CHANNEL_BLURB = {
  careers: "channels.sections.careers.blurb",
  email: "channels.sections.email.blurb",
  ads: "channels.sections.ads.blurb",
  feeds: "channelsNight.shell.blurb.feeds",
  relay: "channelsNight.shell.blurb.relay",
  edge: "channelsNight.shell.blurb.edge",
} as const satisfies Record<NightChannel, string>;

export const CHIP_KEY = {
  published: "channelsNight.plumbing.chip.published",
  nothingPublished: "channels.statusNothingPublished",
  notSetUp: "channelsNight.plumbing.chip.notSetUp",
  delivering: "channels.receivers.healthDelivering",
  waiting: "channels.statusWaiting",
  reachedNoLeads: "channels.receivers.healthReachedNoLeads",
  pullFailing: "channels.receivers.healthPullFailing",
  pushOnly: "channels.pull.statusOff",
  notPulled: "channelsNight.plumbing.chip.notPulled",
  pulling: "channels.pull.statusOn",
  relayNotConfigured: "channels.relay.statusOff",
  relayNotSending: "channelsNight.plumbing.chip.notSending",
  relayNothingSent: "channelsNight.plumbing.chip.nothingSent",
  relayUnreadable: "channels.relay.statusUnreadable",
  edgeNotPaired: "channels.edge.statusOff",
  edgeOffline: "channels.edge.statusOffline",
  edgeSecretMissing: "channels.edge.statusSecretMissing",
  edgeNeverDrained: "channelsNight.plumbing.chip.neverDrained",
  edgeFailing: "channelsNight.plumbing.chip.drainFailing",
  edgePaired: "channels.edge.statusPaired",
  bookNeedsYou: "channelsNight.plumbing.chip.needsYou",
  bookNoneSent: "channelsNight.plumbing.chip.noneSent",
  bookClear: "channelsNight.plumbing.chip.clear",
  bookEmpty: "channelsNight.plumbing.chip.empty",
  notRead: "channels.kit.notRead",
} as const satisfies Record<PlateChip, string>;

/** The edge's backlog, in the edge card's own words. */
export const BACKLOG_KEY = {
  waiting: "channels.edge.pendingWaiting",
  clear: "channels.edge.pendingClear",
  unknown: "channels.edge.pendingUnknown",
} as const;

/** A failing drain, by CLASS (never the machine text), in the edge card's own sentences. */
export const DRAIN_FAIL_KEY = {
  unreachable: "channels.edge.drainFailedUnreachable",
  held: "channels.edge.drainFailedHeld",
  ack: "channels.edge.drainFailedAck",
  secret_unreadable: "channels.edge.drainFailedSecretUnreadable",
  unknown: "channels.edge.drainFailedUnknown",
} as const;
