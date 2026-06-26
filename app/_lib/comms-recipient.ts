// The RECIPIENT-ADDRESSABILITY half of the outbound-comms delivery contract
// (the status half lives in comms-status.ts). `candidateRecipient`
// (comms-dispatch.ts) resolves every message's `to` in priority order —
// captured contact ▸ display name ▸ candidate id ▸ the literal "candidate".
// Only inbound applicants (E4/APP2) carry a real captured contact; proactively-
// SOURCED and manually-added candidates fall through to a name or the literal,
// which a real mail relay cannot deliver to. With COMMS_WEBHOOK_URL set, every
// such comm dead-letters — and nothing flagged the entry as unaddressable
// before send. This module is the one pure check that answers "could a relay
// actually deliver this?", so the Comms Center can warn a recruiter about a
// sourced candidate's missing address up front instead of after the dead-letter.
//
// Kept import-free so the node --test runner loads it directly (db.ts drags in
// better-sqlite3 the type-stripping runner can't resolve).

// The last-resort literal `candidateRecipient` returns when no label/id exists.
// Matched case-insensitively so it never reads as a deliverable address.
const UNADDRESSABLE_LITERAL = "candidate";

// A deliverable recipient is a single, well-formed email address: one `@`, a
// non-empty local part, and a domain carrying at least one dot — no whitespace
// anywhere. Deliberately conservative: a display NAME ("Jane Doe"), an opaque id
// ("ent_ab12"), or the literal "candidate" all lack this shape and read as
// NOT deliverable, which is exactly the "a relay would dead-letter this" signal.
// This is an addressability check, not RFC-5322 validation — a relay/ATS still
// has the final say; we only catch the values that provably cannot be delivered.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whether a resolved recipient string is an address a mail relay could deliver
 *  to. False for names, opaque ids, the "candidate" last-resort literal, and
 *  anything empty — the cases that dead-letter once a real relay is configured. */
export function isDeliverableAddress(recipient: string | null | undefined): boolean {
  const cleaned = (recipient ?? "").trim();
  if (!cleaned) return false;
  if (cleaned.toLowerCase() === UNADDRESSABLE_LITERAL) return false;
  return EMAIL_SHAPE.test(cleaned);
}

/** Extract the first deliverable email address embedded in a free-text field
 *  (e.g. an interviewer entered as `Alice Ng <alice@co.com>` or just
 *  `alice@co.com`), or null when none is present. Lets a name+email free-text
 *  field carry a real address without a schema migration, while a name-only
 *  value stays correctly unaddressable. */
export function extractDeliverableAddress(text: string | null | undefined): string | null {
  const cleaned = (text ?? "").trim();
  if (!cleaned) return null;
  for (const token of cleaned.split(/[\s<>,;()]+/)) {
    if (isDeliverableAddress(token)) return token;
  }
  return null;
}

/** The human-readable name part of a `Name <email>` (or plain `Name`) free-text
 *  value, with any embedded address stripped. Returns null when only an address
 *  (or nothing) is present, so callers can fall back to a generic label. */
export function extractRecipientName(text: string | null | undefined): string | null {
  const cleaned = (text ?? "").trim();
  if (!cleaned) return null;
  const addr = extractDeliverableAddress(cleaned);
  const withoutAddr = addr ? cleaned.replace(addr, "") : cleaned;
  const name = withoutAddr.replace(/[<>,;()]+/g, " ").replace(/\s+/g, " ").trim();
  return name || null;
}
