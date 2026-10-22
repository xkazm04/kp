// Turning a careers-page URL into the plain advertisement text the posting corpus
// stores (db/job-postings.ts, docs/features/intake/README.md).
//
// Deliberately dependency-free: a readability/DOM library would be a new npm
// dependency for one route, and the job here is narrow — a job ad is prose, not an
// app. What this cannot do is render client-side pages; a JS-only careers site
// returns a near-empty body, which the route answers as POSTING_FETCH_FAILED rather
// than storing an empty posting.

import { defaultHostLookup, isPrivateAddress, type HostLookup } from "./ats-egress-guard.ts";

const BLOCK_TAGS =
  "address|article|aside|blockquote|br|div|dd|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  // The three that show up constantly in copy-pasted ads.
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

/** Decode the entity forms an ad actually contains: the handful of named ones above
 *  plus any numeric reference. Unknown named entities are left verbatim — inventing a
 *  character would be worse than showing `&foo;`. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole; /* a lone surrogate or other invalid code point — keep the source text */
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

/** HTML → the readable text of the advertisement. Script/style/noscript/svg content is
 *  DROPPED (not merely untagged — otherwise a page's inline JS lands in the corpus as
 *  prose), block tags become newlines so bullet lists survive, and every run of
 *  newlines collapses to ONE. A block tag emits a break on both its opening and its
 *  closing form, so "at most one blank line" would in practice mean a blank line
 *  between every paragraph — one break per block is the readable shape, and it is the
 *  shape the corpus stores. */
export function htmlToText(html: string): string {
  let text = html;
  // Comments and non-prose elements, content included.
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1\s*>/gi, " ");
  // An unclosed <script>/<style> (a truncated download) would otherwise leak its whole
  // tail into the text; drop from the opening tag to the end.
  text = text.replace(/<(script|style|noscript|svg)\b[\s\S]*$/i, " ");
  // Block boundaries become line breaks BEFORE tags are stripped, so "</li><li>" does
  // not weld two bullets into one word.
  text = text.replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n");
  text = text.replace(/<[^>]*>/g, " ");
  text = decodeEntities(text);
  // Collapse: spaces/tabs run together, and a run of newlines becomes one.
  text = text.replace(/\r\n?/g, "\n");
  text = text.replace(/[^\S\n]+/g, " ");
  text = text.replace(/ *\n */g, "\n");
  text = text.replace(/\n{2,}/g, "\n");
  return text.trim();
}

/** The page's <title>, cleaned of the site-name suffix recruiters' CMSes append. */
export function htmlTitle(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (!match) return null;
  const raw = decodeEntities(match[1]).replace(/\s+/g, " ").trim();
  return raw ? raw.slice(0, 300) : null;
}

/** 15 seconds: long enough for a slow corporate careers page, short enough that a
 *  hanging host cannot occupy the handler — `maxDuration` is serverless-only and this
 *  app self-hosts, so the abort signal IS the bound. */
export const POSTING_FETCH_TIMEOUT_MS = 15_000;

export class PostingFetchError extends Error {}

/** Redirect hops followed by hand; the 6th redirect is refused. */
export const POSTING_MAX_REDIRECTS = 5;

/** SSRF vet of one hop: resolve the host and refuse it when it is — or resolves to —
 *  any non-public address (loopback, private, link-local/metadata, CGNAT, ULA). A
 *  literal IP resolves to itself, so it takes the same path. Http stays allowed, unlike
 *  the https-only webhook guard. Resolve-and-reject, not a pin: see ats-egress-guard. */
async function assertPublicHost(url: URL, lookupFn: HostLookup): Promise<void> {
  const host = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  let results: Array<{ address: string }>;
  try {
    results = await lookupFn(host);
  } catch {
    throw new PostingFetchError(`the host "${host}" could not be resolved`);
  }
  if (results.length === 0) throw new PostingFetchError(`the host "${host}" did not resolve to any address`);
  for (const { address } of results) {
    if (isPrivateAddress(address)) throw new PostingFetchError(`the host "${host}" is not a public address`);
  }
}

/** Fetch a posting page and extract {title, text}. Throws PostingFetchError for every
 *  refusable condition (bad scheme, a non-public host at the start or at any redirect
 *  hop, too many redirects, non-OK status, a content type that is not text/html or
 *  text/plain, a timeout) so the route answers ONE code rather than forwarding a
 *  network library's message. Redirects are followed by hand so each Location is
 *  vetted before it is requested. Egress in offline mode is refused by the ROUTE, up
 *  front, so the caller gets a decision instead of a blocked-fetch accident. */
export async function fetchPostingText(
  url: string,
  lookupFn: HostLookup = defaultHostLookup,
): Promise<{ title: string | null; text: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PostingFetchError("the URL could not be parsed");
  }
  const signal = AbortSignal.timeout(POSTING_FETCH_TIMEOUT_MS);
  let response: Response;
  for (let hops = 0; ; hops++) {
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new PostingFetchError(`unsupported scheme ${parsed.protocol}`);
    }
    await assertPublicHost(parsed, lookupFn);
    try {
      response = await fetch(parsed, {
        redirect: "manual",
        signal,
        headers: { accept: "text/html,text/plain;q=0.9", "user-agent": "kp-posting-import/1.0" },
      });
    } catch (error) {
      throw new PostingFetchError(`the page could not be fetched: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    if (!location) break; // a 3xx with no target falls to the !ok refusal below
    if (hops >= POSTING_MAX_REDIRECTS) throw new PostingFetchError("too many redirects");
    try {
      parsed = new URL(location, parsed);
    } catch {
      throw new PostingFetchError("a redirect pointed at an unparseable URL");
    }
  }
  if (!response.ok) throw new PostingFetchError(`the page answered HTTP ${response.status}`);
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml");
  const isPlain = contentType.includes("text/plain");
  if (!isHtml && !isPlain) throw new PostingFetchError(`the page is ${contentType || "of an unknown type"}, not readable text`);
  const body = await response.text();
  return isHtml
    ? { title: htmlTitle(body), text: htmlToText(body) }
    : { title: null, text: body.replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").trim() };
}
