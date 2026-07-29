// Pure types + helpers for the Comms ledger (ChannelsCommsTable), split out so
// the table file stays under the 200-line cap.

import type { OutboxStatus } from "@/app/_lib/comms-status";
import type { BadgeTone } from "@/app/_components/Badge";
import { labelize } from "@/app/_lib/format";

export type Message = {
  id: string;
  recipient: string | null;
  subject: string | null;
  body: string | null;
  kind: string | null;
  channel: string | null;
  status: OutboxStatus;
  ref: string | null;
  createdAt: string;
  recovered?: boolean;
  recoveredAt?: string | null;
  deliverable?: boolean;
  bounced?: boolean;
  bouncedAt?: string | null;
  bounceDetail?: string | null;
};
export type RefInfo = { label: string; jobTitle: string | null };

// A dead letter (failed, not yet recovered by a later resend) or a sent row the
// relay later bounced — both need the recruiter to chase.
export const isActionable = (m: Message) => (m.status === "failed" && !m.recovered) || Boolean(m.bounced);

export function statusTone(m: Message): { tone: BadgeTone; label: string } {
  if (m.bounced) return { tone: "critical", label: "Bounced" };
  if (m.status === "failed") return m.recovered ? { tone: "positive", label: "Recovered" } : { tone: "critical", label: "Failed" };
  if (m.status === "sent") return { tone: "positive", label: "Sent" };
  if (m.status === "queued") return { tone: "info", label: "Queued" };
  return { tone: "neutral", label: labelize(m.status) };
}

export const PAGE_SIZE = 40;
