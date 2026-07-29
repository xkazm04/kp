import type { LucideIcon } from "lucide-react";
import { Link2, Mail, MailOpen, Megaphone } from "lucide-react";

// The four inbound-integration surfaces the redesigned Channels page switches
// between. Proactive sourcing + Manual add are intentionally descoped from this
// page (they live in Match / Profile). Shared by the prototype variants so the
// nav order + copy stay identical while each variant styles the chrome its own way.
export type ChannelSectionId = "comms" | "careers" | "email" | "ads";

export type ChannelSection = {
  id: ChannelSectionId;
  label: string;
  icon: LucideIcon;
  /** One-line description of what the section is for. */
  blurb: string;
  /** The webhook `channel` key this section manages (comms/careers have none). */
  channel?: string;
};

export const CHANNEL_SECTIONS: ChannelSection[] = [
  { id: "comms", label: "Communications", icon: MailOpen, blurb: "Every candidate-facing message, in one auditable ledger." },
  { id: "careers", label: "Careers page", icon: Link2, blurb: "Your public apply page — one link, embeddable anywhere." },
  { id: "email", label: "Email intake", icon: Mail, blurb: "Forward applications from a mailbox straight into the pipeline.", channel: "email" },
  { id: "ads", label: "Ad forms", icon: Megaphone, blurb: "Lead-gen ad forms (LinkedIn / Meta) post their leads in.", channel: "boards" },
];
