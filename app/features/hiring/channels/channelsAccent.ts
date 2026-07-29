// Per-section accent tokens for the Channels "Intake Studio" tab switcher and
// stage. Split out of ChannelsTab.tsx so the tab file stays under the
// 200-line cap. Accents are drawn only from Badge-mapped tones (coral/moss/
// blue/amber) so both themes stay honest.

import type { ChannelSectionId } from "./channelsSections";

export type Accent = { text: string; soft: string; border: string };

export const CHANNEL_ACCENT: Record<ChannelSectionId, Accent> = {
  comms: { text: "text-coral", soft: "bg-coral/10", border: "border-coral/30" },
  careers: { text: "text-moss", soft: "bg-moss/10", border: "border-moss/30" },
  email: { text: "text-blue-700", soft: "bg-blue-50", border: "border-blue-200" },
  ads: { text: "text-amber-700", soft: "bg-amber-50", border: "border-amber-200" },
};
