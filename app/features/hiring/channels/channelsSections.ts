import type { LucideIcon } from "lucide-react";
import { Link2, Mail, MailOpen, Megaphone } from "lucide-react";

// The four inbound-integration surfaces the redesigned Channels page switches
// between. Proactive sourcing + Manual add are intentionally descoped from this
// page (they live in Match / Profile).
//
// channels-i18n-honesty: the human-readable label + blurb moved OUT of here and
// into the `channels.sections.*` catalog (×4 locales). This module carries only
// what cannot be localized — the order, the icon and the webhook channel binding.
export type ChannelSectionId = "comms" | "careers" | "email" | "ads";

export type ChannelSection = {
  id: ChannelSectionId;
  icon: LucideIcon;
  /** The webhook `channel` key this section manages (comms/careers have none). */
  channel?: string;
};

export const CHANNEL_SECTIONS: ChannelSection[] = [
  { id: "comms", icon: MailOpen },
  { id: "careers", icon: Link2 },
  { id: "email", icon: Mail, channel: "email" },
  { id: "ads", icon: Megaphone, channel: "boards" },
];
