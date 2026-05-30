import { recordOutbox, type OutboxEntry } from "./db";

// Direction B — outbound communications. Pluggable channel, mirroring the deterministic-
// fallback pattern: a durable local OUTBOX by default (always works, also serves as the
// audit log), or a real HTTP relay when COMMS_WEBHOOK_URL is set (wire to SendGrid / a
// mail relay / Zapier / an ATS). Every message is recorded either way.

export type OutboundMessage = { to: string; subject: string; body: string; kind: string; ref?: string };

export interface CommsChannel {
  readonly name: string;
  send(msg: OutboundMessage): Promise<OutboxEntry>;
}

// Local outbox: records the message as "queued" (nothing is actually delivered offline).
class OutboxChannel implements CommsChannel {
  readonly name = "outbox";
  async send(msg: OutboundMessage): Promise<OutboxEntry> {
    return recordOutbox({ recipient: msg.to, subject: msg.subject, body: msg.body, kind: msg.kind, channel: this.name, status: "queued", ref: msg.ref });
  }
}

// Real channel: POST the message to a configured relay; records sent/failed.
class WebhookChannel implements CommsChannel {
  readonly name = "webhook";
  constructor(private readonly url: string) {}
  async send(msg: OutboundMessage): Promise<OutboxEntry> {
    let status = "sent";
    try {
      const r = await fetch(this.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(msg) });
      if (!r.ok) status = `failed:${r.status}`;
    } catch {
      status = "failed";
    }
    return recordOutbox({ recipient: msg.to, subject: msg.subject, body: msg.body, kind: msg.kind, channel: this.name, status, ref: msg.ref });
  }
}

export function getCommsChannel(): CommsChannel {
  const url = process.env.COMMS_WEBHOOK_URL;
  return url ? new WebhookChannel(url) : new OutboxChannel();
}

/** Convenience: dispatch one message through the active channel. */
export async function sendComm(msg: OutboundMessage): Promise<OutboxEntry> {
  return getCommsChannel().send(msg);
}
