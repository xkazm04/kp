// Segment speech-ready text into synthesis chunks. Latency scales with text
// length (a local CPU engine renders ~2x faster than real time, so 1200 chars
// is ~30-40 s before the first word); the fix is chunking at sentence
// boundaries and playing chunk N while chunk N+1 renders. Isomorphic + pure.
//
// Rules (each one earned by an audible defect):
//   - split only at sentence ends (.!?…) — prosody resets per chunk, so a
//     mid-phrase cut is a robotic hiccup; the FIRST chunk may end at a clause
//     mark (, ; : —) once past minChars, because time-to-first-audio wins there;
//   - never split on a dot that is a decimal (3.14), a time (14:30), an
//     abbreviation (Dr., e.g., č., tzv.), or an inflected-language ordinal
//     ("7. dubna" — the dot is NOT a sentence end: next word is lowercase);
//   - never split inside an open quote or bracket;
//   - chunks below minChars merge forward; chunks above maxChars force-split
//     at the best comma, then at a space.

export type SegmentOptions = { minChars?: number; maxChars?: number; firstChunkClause?: boolean };

const ABBREVIATIONS = new Set(
  [
    // en
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "inc", "ltd", "co", "no", "fig", "approx",
    // cs / sk / de
    "č", "tzv", "tj", "např", "popř", "resp", "atd", "apod", "str", "ing", "mgr", "bc", "phdr", "mudr", "judr", "p", "s", "sv", "hod", "min", "mil", "tis", "kč",
    "z.b", "bzw", "usw", "ca", "nr", "hr", "fr", "evtl",
  ].map((a) => a.toLowerCase()),
);

const OPENERS = "(\"“„«‚'[";
const CLOSERS = ")\"”“»’']";

function balanced(s: string): boolean {
  let depth = 0;
  let dq = 0;
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === '"') dq ^= 1;
  }
  return depth === 0 && dq === 0;
}

/** True when the terminal mark at `i` (text[i] in .!?…) is a real sentence end. */
function isSentenceEnd(text: string, i: number): boolean {
  const ch = text[i];
  const next = text[i + 1];
  const after = text.slice(i + 1, i + 3);
  // Needs whitespace (or end) after — plus optional closing quote/bracket.
  const rest = text.slice(i + 1);
  const m = /^[)"”»’'\]]*(\s|$)/.exec(rest);
  if (!m) return false;
  if (ch !== ".") return true;
  if (next && /\d/.test(next)) return false; // 3.14
  // Word before the dot.
  const before = /([\p{L}\p{N}.]+)$/u.exec(text.slice(0, i));
  const word = before?.[1] ?? "";
  if (/^\d+$/.test(word)) {
    // "7. dubna" / "1. Januar": ordinal if the next word starts lowercase.
    const nextWord = /^\s+(\S)/.exec(rest);
    if (nextWord && /\p{Ll}/u.test(nextWord[1])) return false;
  }
  if (ABBREVIATIONS.has(word.toLowerCase().replace(/\.$/, ""))) return false;
  if (word.length === 1 && /\p{Lu}/u.test(word)) return false; // initials: "J. Novák"
  void after;
  return true;
}

function forceSplit(chunk: string, maxChars: number): string[] {
  const out: string[] = [];
  let rest = chunk;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    let cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(": "), window.lastIndexOf(" — "));
    if (cut < maxChars * 0.4) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = maxChars;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export function segmentSpeech(text: string, opts: SegmentOptions = {}): string[] {
  const minChars = opts.minChars ?? 40;
  const maxChars = opts.maxChars ?? 280;
  const firstClause = opts.firstChunkClause ?? true;
  const s = text.replace(/\s+/g, " ").trim();
  if (!s) return [];

  // Pass 1: sentences.
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (".!?…".includes(s[i]) && isSentenceEnd(s, i)) {
      // include trailing closers
      let end = i + 1;
      while (end < s.length && CLOSERS.includes(s[end])) end++;
      const cand = s.slice(start, end).trim();
      if (cand && balanced(cand)) {
        sentences.push(cand);
        start = end;
      }
    }
  }
  const tail = s.slice(start).trim();
  if (tail) sentences.push(tail);

  // Pass 2: merge short, split long.
  const chunks: string[] = [];
  let buf = "";
  for (const sent of sentences) {
    buf = buf ? `${buf} ${sent}` : sent;
    if (buf.length >= minChars) {
      chunks.push(...forceSplit(buf, maxChars));
      buf = "";
    }
  }
  if (buf) {
    if (chunks.length && buf.length < minChars && chunks[chunks.length - 1].length + buf.length + 1 <= maxChars) {
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${buf}`;
    } else chunks.push(...forceSplit(buf, maxChars));
  }

  // Pass 3: the first chunk may stop at a clause mark to win time-to-first-audio.
  if (firstClause && chunks.length && chunks[0].length > minChars * 2) {
    const first = chunks[0];
    const window = first.slice(minChars, Math.min(first.length, maxChars / 2));
    const rel = [window.indexOf(", "), window.indexOf("; "), window.indexOf(": "), window.indexOf(" — ")].filter((x) => x >= 0);
    if (rel.length) {
      const cut = minChars + Math.min(...rel) + 1;
      const head = first.slice(0, cut).trim();
      const rest = first.slice(cut).trim();
      if (head && rest && !OPENERS.includes(head[head.length - 1])) chunks.splice(0, 1, head, rest);
    }
  }
  return chunks.filter(Boolean);
}
