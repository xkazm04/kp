"use client";

import { Send } from "lucide-react";
import type { OutboxItem } from "./DevTypes";

export function OutboxSection({ outbox }: { outbox: OutboxItem[] }) {
  if (outbox.length === 0) return null;
  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <Send size={13} className="text-coral" /> Comms outbox <span className="text-coral">· {outbox.length}</span>
      </h3>
      <p className="mt-1 text-micro text-steel">
        Every message the pipeline sent (acknowledgements on intake, invites on promote). &quot;queued&quot; = recorded locally;
        set <span className="font-mono">COMMS_WEBHOOK_URL</span> to relay through a real channel (email / ATS).
      </p>
      <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white shadow-panel">
        {outbox.slice(0, 12).map((m) => (
          <li key={m.id} className="flex items-center gap-2 px-3 py-1.5 text-micro">
            <span
              className={`rounded-full px-1.5 py-0.5 text-micro font-semibold uppercase ${
                m.kind === "invite" ? "bg-moss/15 text-moss" : "bg-paper text-steel"
              }`}
            >
              {m.kind}
            </span>
            <span className="w-28 shrink-0 truncate text-steel">{m.recipient}</span>
            <span className="min-w-0 flex-1 truncate text-ink">{m.subject}</span>
            <span className="shrink-0 text-micro uppercase text-steel">{m.status === "queued" ? `${m.channel}` : m.status}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
