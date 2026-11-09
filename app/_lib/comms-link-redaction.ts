// Candidate capability links in a stored letter body, withheld from a read-only seat.
//
// A letter in the outbox carries the candidate's own door: /offer/<token> accepts or declines
// a real offer, /schedule/<token> books or cancels, /status/<token> and /data/<token> show or
// erase the candidate's data, /stop/<token> opts them out, /interview/<token> runs their
// interview. The token IS the credential, so whoever can read the body can act as the
// candidate. A `viewer` holds only `read`, so the READ projections (GET /api/comms, the
// pipeline timeline, GET /api/devcase/comms) rewrite every such link to a tokenless
// placeholder unless the caller holds `pipeline:write`. The stored row, the send path,
// resend and the composer never pass through here.

export const CANDIDATE_LINK_PLACEHOLDER = "redacted";

const DOORS = "offer|schedule|status|data|stop|interview";
// Optional absolute prefix (scheme + host), the door, then the token and any query up to
// whitespace or a closing delimiter. Percent-encoded bytes (%2F, %20 …) sit inside the run.
const LINK = new RegExp(`((?:https?:\\/\\/[^\\s/<>"')\\]]+)?\\/(?:${DOORS})\\/)[^\\s<>"')\\]]+`, "gi");

/** Rewrite candidate capability links to `<door>/redacted`, query string included. Trailing
 *  sentence punctuation after a link is kept. Pure; a body with no link is returned as is. */
export function redactCandidateLinks(body: string): string {
  if (!body) return body;
  return body.replace(LINK, (match, head: string) => {
    const trailing = /[.,;:!?]+$/.exec(match)?.[0] ?? "";
    return `${head}${CANDIDATE_LINK_PLACEHOLDER}${trailing}`;
  });
}

/** The read projection: `rows` unchanged for a caller who may act on letters, otherwise a
 *  copy of each row with its body redacted. Never mutates the input rows. */
export function withLinksRedactedUnless<T extends { body: string | null }>(canWrite: boolean, rows: readonly T[]): T[] {
  if (canWrite) return rows as T[];
  return rows.map((r) => (r.body ? { ...r, body: redactCandidateLinks(r.body) } : r));
}
