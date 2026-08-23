// Speech-ready text: what a chat reply must become before any engine sees it.
// Engines voice markdown literally ("asterisk asterisk", "hash"), read URLs
// character by character, and either name emoji or emit garbage. This is one
// pure function, isomorphic (browser + server), and deliberately conservative:
// it removes markup and un-speakable content, it does NOT expand numbers —
// number/date/currency expansion is locale- and case-dependent (inflected
// languages) and belongs to a per-locale normalizer the host supplies.

export type SpeechReadyOptions = {
  /** Spoken stand-in for a fenced code block; "" drops it silently. */
  codePlaceholder?: string;
  /** Spoken stand-in for a table; "" drops it. */
  tablePlaceholder?: string;
};

const EMOJI_RE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;

/** Ensure a fragment ends with terminal punctuation so the engine closes the
 *  phrase instead of running it into the next line. */
function terminate(line: string): string {
  const t = line.trim();
  if (!t) return "";
  return /[.!?…:;]$/.test(t) ? t : `${t}.`;
}

export function speechReady(input: string, opts: SpeechReadyOptions = {}): string {
  let s = input.replace(/\r\n?/g, "\n");

  // Fenced code: never voiced verbatim.
  s = s.replace(/```[\s\S]*?```/g, () => (opts.codePlaceholder ? ` ${terminate(opts.codePlaceholder)} ` : " "));
  // HTML tags and comments.
  s = s.replace(/<!--[\s\S]*?-->/g, " ").replace(/<\/?[a-zA-Z][^>]*>/g, " ");
  // Images: drop entirely; links: keep the anchor text only.
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // Bare URLs and emails are unspeakable.
  s = s.replace(/\bhttps?:\/\/\S+/gi, " ").replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, " ");
  // Inline code: keep short identifiers, drop long ones.
  s = s.replace(/`([^`\n]*)`/g, (_m, code: string) => (code.length <= 24 ? code : " "));

  const out: string[] = [];
  const lines = s.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // Tables: a block of pipe rows becomes one placeholder.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1])) i++;
      if (opts.tablePlaceholder) out.push(terminate(opts.tablePlaceholder));
      continue;
    }
    // Horizontal rules / blockquote markers / headings / bullets / numbered items.
    if (/^\s*([-*_]\s*){3,}$/.test(line)) continue;
    line = line.replace(/^\s*>+\s?/, "");
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) line = heading[1];
    line = line.replace(/^\s*(?:[-*+•]|\d{1,3}[.)])\s+/, "");
    // Emphasis markers.
    line = line.replace(/(\*\*|__)(.*?)\1/g, "$2").replace(/(?<!\w)[*_](?!\s)(.*?)(?<!\s)[*_](?!\w)/g, "$1").replace(/~~(.*?)~~/g, "$1");
    line = line.replace(EMOJI_RE, "");
    // 5+ repeated punctuation reads as a stall; collapse.
    line = line.replace(/([!?.])\1{2,}/g, "$1$1$1");
    const t = line.replace(/[ \t]+/g, " ").trim();
    if (!t) continue;
    // A line break in prose is usually a paragraph/list boundary: terminate it.
    out.push(terminate(t));
  }
  return out.join(" ").replace(/\s+([,.;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
}
