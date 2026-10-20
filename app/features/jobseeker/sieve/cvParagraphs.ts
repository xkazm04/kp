// The CV as dropped, read back as paragraphs - pure, so `node --test` pins it.
//
// A PDF's text comes out one PRINTED line per line: a summary set 60 characters wide
// arrives as seven hard-broken lines, and the sheet on /me re-wrapped each of them in its
// narrower column - a ragged half-line after every line (the operator's own CV on the live
// run, 2026-09-28). A line that CONTINUES the one above it rejoins it: it starts in lower
// case, or the line above stops mid-phrase (a comma, an ampersand, an open dash, a joining
// word such as "with" or "including", a hyphen inside a word). Nothing is added, dropped or
// reordered - only the break goes.
//
// Never joined: the first line (the name), a heading, a line that starts an item (a bullet,
// a date), contact data (an address, a URL, a phone number), or anything after a line that
// ends a sentence or a label - a trailing colon, or a short line in capitals.

const JOINING_WORDS = new Set([
  "and", "or", "with", "of", "the", "a", "an", "in", "on", "for", "to", "by", "from", "into", "across", "within",
  "including", "using", "as", "at", "via", "per",
  "und", "oder", "mit", "für", "von", "der", "die", "das", "im", "zur", "zum",
  "et", "ou", "avec", "pour", "de", "des", "du", "le", "la", "les", "en",
  "pro", "na", "ve", "ze", "do", "pomocí", "včetně",
]);

/** A bullet or a date at the start: a new item, never the rest of the last one. */
const ITEM_START = /^(?:[•●▪◦·*–—-]\s|\d{1,2}[./]\d{2,4}\b|\d{4}\s*[–—-])/u;
/** A sentence or a label ends here. */
const ENDS = /[.!?:;]$/u;
const CONTACT = /@|https?:\/\/|www\.|(?:^|\s)[\w.-]+\.(?:com|cz|sk|de|at|io|dev|org|net|eu|ai)(?:\/\S*)?(?:\s|$)|^\+?\d[\d\s]{6,}/iu;

/** A short line in capitals labels what follows ("LLM RELATED" over "n8n workflows"). */
function capsLabel(line: string): boolean {
  return line.length <= 40 && line === line.toUpperCase() && line !== line.toLowerCase();
}

function continues(prev: string, line: string): boolean {
  if (ENDS.test(prev) || ITEM_START.test(line) || CONTACT.test(prev) || CONTACT.test(line) || capsLabel(prev)) return false;
  if (/^\p{Ll}/u.test(line)) return true;
  if (/[,&/(—–]$/u.test(prev) || /\p{L}-$/u.test(prev)) return true;
  const last = prev.split(/\s+/).pop()!.toLowerCase();
  return JOINING_WORDS.has(last);
}

/**
 * The source's non-empty lines with every soft wrap rejoined. `isHeading` names the lines
 * that stand alone (a section title). A blank line always ends a paragraph.
 */
export function softWrapsJoined(lines: readonly string[], isHeading: (line: string) => boolean): string[] {
  const out: string[] = [];
  let open = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      open = false;
      continue;
    }
    const heading = out.length > 0 && isHeading(line);
    const prev = open && !heading ? out[out.length - 1] : undefined;
    if (prev !== undefined && continues(prev, line)) {
      // "prototype-to-" + "production" keeps its hyphen and loses only the break.
      out[out.length - 1] = /\p{L}-$/u.test(prev) && /^\p{Ll}/u.test(line) ? prev + line : `${prev} ${line}`;
      continue;
    }
    out.push(line);
    // The name line and a heading stand alone; anything else may take a continuation.
    open = out.length > 1 && !heading;
  }
  return out;
}
