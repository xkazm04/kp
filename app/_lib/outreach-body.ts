// The BODY half of the outreach send gate (the consent/halt half is
// `commsSendSuppression`, comms.ts). An outreach body is the model's draft — written
// by an LLM that read the candidate's CV, so its text is only as trusted as that CV —
// and it used to reach the outbox and the relay exactly as generated: any length, any
// markup. A relay that renders HTML turns a smuggled `<a href>` or tracking `<img>`
// into something the candidate sees under the operator's name, and a runaway draft of
// megabytes is stored whole and spends relay quota.
//
// Cleaned, not escaped: the outbound contract is plain text, so tags are REMOVED (their
// words kept) and `<script>`/`<style>` lose their contents too. Unlike
// `sanitizeFreeText` this keeps the letter's line structure — newlines are the
// formatting of a plain-text email — and only folds runs of blank lines.
//
// Refused, not truncated: a letter cut mid-sentence and sent is worse than one not
// sent, and the cap is measured on the whole message, so truncating could cut off the
// opt-out footer that sendCandidateComm appends (ePrivacy: every commercial message
// carries a way to decline).
//
// Import-free apart from the pure text helpers, so node --test loads it directly.
import { HTML_TAG, INVISIBLE } from "./text-sanitize.ts";

/** Longest outreach message (body + footers, after cleaning) the channel accepts.
 *  A first-contact letter is a few hundred words; 20,000 characters is the JD body cap
 *  (jd-limits.ts) and leaves an order of magnitude of headroom for a legitimate one. */
export const OUTREACH_BODY_MAX_LENGTH = 20_000;

const SCRIPT_OR_STYLE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

function stripMarkup(value: string): string {
  return value.replace(SCRIPT_OR_STYLE, "").replace(HTML_COMMENT, "").replace(HTML_TAG, "");
}

/** Plain-text outreach body: CRLF normalized, invisible/bidi code points removed,
 *  markup stripped, trailing spaces dropped, 3+ newlines folded to one blank line,
 *  trimmed. Idempotent — the strip repeats until nothing changes, so a tag split by
 *  another tag (`<scr<b>ipt>`) cannot reassemble on the way out. */
export function cleanOutreachBody(value: string): string {
  let text = value.replace(/\r\n?/g, "\n").replace(INVISIBLE, "");
  for (let next = stripMarkup(text); next !== text; next = stripMarkup(text)) text = next;
  return text
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Why a CLEANED outreach body may not be sent, or null. */
export function outreachBodyRefusal(body: string): "body_too_long" | null {
  return body.length > OUTREACH_BODY_MAX_LENGTH ? "body_too_long" : null;
}
