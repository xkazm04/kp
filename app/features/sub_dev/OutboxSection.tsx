"use client";

import { Send } from "lucide-react";
import type { LoadState } from "@/app/_lib/useLoader";
import type { OutboxStatus } from "@/app/_lib/comms-status";
import { DevSection } from "./DevShared";
import type { OutboxItem } from "./DevTypes";

// Badge tints by message kind — positive (invite/outreach/ack) vs. adverse (rejection).
const KIND_STYLE: Record<string, string> = {
  invite: "bg-moss/15 text-moss",
  acknowledgement: "bg-moss/15 text-moss",
  outreach: "bg-coral/15 text-coral",
  rejection: "bg-red-50 text-red-700",
};

// Delivery-status tint — `failed` (dead-letter) is loud so a dropped offer/rejection
// never reads as benign. `queued` shows the channel (local, terminal dev state).
const STATUS_STYLE: Record<OutboxStatus, string> = {
  queued: "text-steel",
  sent: "text-moss",
  failed: "text-red-700 font-semibold",
};

export function OutboxSection({ outbox, state }: { outbox: OutboxItem[]; state: LoadState }) {
  return (
    <DevSection icon={<Send size={13} className="text-coral" />} title="Comms outbox" count={outbox.length} state={state} label="the comms outbox">
      <p className="mt-1 text-micro text-steel">
        Every message the pipeline sent — intake acknowledgements, promote invites, recruiter outreach, and rejections.
        &quot;queued&quot; = recorded locally (terminal until a relay is wired); set{" "}
        <span className="font-mono">COMMS_WEBHOOK_URL</span> to relay through a real channel (email / ATS), where messages
        resolve to <span className="text-moss">sent</span> or, on a dropped delivery,{" "}
        <span className="font-semibold text-red-700">failed</span> (dead-lettered — needs attention).
      </p>
      <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white shadow-panel">
        {outbox.slice(0, 12).map((m) => (
          <li key={m.id} className="flex items-center gap-2 px-3 py-1.5 text-micro">
            <span
              className={`rounded-full px-1.5 py-0.5 text-micro font-semibold uppercase ${
                KIND_STYLE[m.kind ?? ""] ?? "bg-paper text-steel"
              }`}
            >
              {m.kind}
            </span>
            <span className="w-28 shrink-0 truncate text-steel">{m.recipient}</span>
            <span className="min-w-0 flex-1 truncate text-ink">{m.subject}</span>
            <span className={`shrink-0 text-micro uppercase ${STATUS_STYLE[m.status] ?? "text-steel"}`}>
              {m.status === "queued" ? `${m.channel}` : m.status}
            </span>
          </li>
        ))}
      </ul>
    </DevSection>
  );
}
