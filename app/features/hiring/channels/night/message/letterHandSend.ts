/*
 * Sending a letter yourself (level 3): pure, pinned by letterHandSend.test.ts.
 *
 * With no relay, a letter is a terminal `queued` row (docs/features/comms/README.md §2), and a
 * dead letter or a bounce waits on a person. The owner can still get it to the candidate through
 * their own mail: copy it, or open it in their mail program. Neither touches the record; the view
 * says so. Everything here reads only fields the letter view already holds: no new PII is fetched.
 */
import { commsVerdict, isReceiptRecipient } from "@/app/_lib/comms-view.ts";
import { REFUSED_COMMS_CHANNEL, SIM_COMMS_CHANNEL } from "@/app/_lib/comms-resend-outcome.ts";
import type { Message } from "../../channelsCommsHelpers.ts";

/** Mail programs start truncating or refusing `mailto:` URLs somewhere past 2000 characters
 *  (Outlook on Windows is the tightest); 1800 leaves headroom for the address and subject. */
export const MAILTO_MAX = 1800;

type Letter = Pick<Message, "subject" | "body" | "channel" | "status" | "bounced" | "recovered" | "orphaned">;

/** A letter a person may send by hand: one that did not reach the candidate and is not a
 *  simulation row or a refused one (those were never meant for a real inbox). */
export function canHandSend(m: Letter): boolean {
  if (m.channel === SIM_COMMS_CHANNEL || m.channel === REFUSED_COMMS_CHANNEL) return false;
  const v = commsVerdict(m);
  if (v !== "queued" && v !== "failed" && v !== "bounced") return false;
  return Boolean(m.body?.trim() || m.subject?.trim());
}

/** The letter as plain text: the subject line, a blank line, the body. */
export function letterPlainText(m: Pick<Message, "subject" | "body">): string {
  const subject = m.subject?.trim() ?? "";
  const body = m.body ?? "";
  if (subject && body.trim()) return `${subject}\n\n${body}`;
  return subject || body;
}

// One address, nothing that could smuggle a second header (`?`, `&`, whitespace, a comma list).
const ADDRESS = /^[^\s@?&,;<>"]+@[^\s@?&,;<>"]+\.[^\s@?&,;<>"]+$/;

/** The stored recipient when it is a usable mail address; a receipt code or anything else is "". */
export function mailAddressOf(recipient: string | null | undefined): string {
  const r = recipient?.trim() ?? "";
  if (!r || isReceiptRecipient(r) || !ADDRESS.test(r)) return "";
  return r;
}

// RFC 6068: line breaks in a mailto body are %0D%0A.
const enc = (s: string) => encodeURIComponent(s.replace(/\r?\n/g, "\r\n"));

/**
 * The `mailto:` for a letter. `cut` is true when the body exists but the full URL would pass `max`:
 * the link then carries the address and subject only, and the caller copies the letter instead.
 */
export function letterMailto(m: Pick<Message, "recipient" | "subject" | "body">, max: number = MAILTO_MAX): { href: string; cut: boolean } {
  const address = mailAddressOf(m.recipient);
  const to = address ? address.split("@").map(encodeURIComponent).join("@") : "";
  const subject = m.subject?.trim() ?? "";
  const body = m.body?.trim() ? m.body : "";
  const query = (withBody: boolean) => {
    const parts: string[] = [];
    if (subject) parts.push(`subject=${enc(subject)}`);
    if (withBody && body) parts.push(`body=${enc(body)}`);
    return parts.length ? `?${parts.join("&")}` : "";
  };
  const full = `mailto:${to}${query(true)}`;
  if (!body || full.length <= max) return { href: full, cut: false };
  return { href: `mailto:${to}${query(false)}`, cut: true };
}
