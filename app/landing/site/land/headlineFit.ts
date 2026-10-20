/*
 * How wide a line of display type is, in em, measured without a browser.
 *
 * The landing's and About's display lines are drawn at one size per viewport, and English fits it. Longer locales do
 * not: the hero's French "Votre recrutement, / en [pilote automatique]" is ~11em against a phone's ~7em, the ring's
 * German heading took a third line, a scene's French name a second, About's stamp word ran out of its block. The CSS
 * sets such a line smaller only when its em width would overflow the room it has (`--h1-em`, `--fh-em`, `--st-em`,
 * `--seal-em`, `--hh-em`), so the server (or the first render) has to know that width before anything paints.
 *
 * These are the advances of Bricolage Grotesque ExtraBold with -.03em tracking, measured in Chromium at 36px (the
 * smallest size the fits produce; the variable face's optical sizing makes it a little wider there than at 80px, so
 * the table over-estimates at desktop sizes, the safe direction). Kerning is ignored: the whole-string error
 * measured against the four catalogs is under 1.5%, and SAFETY covers it. Letters with diacritics count as their
 * base letter; a glyph the table does not know counts as an average capital.
 */

const LOWER = [55, 60, 53, 60, 54, 37, 56, 59, 24, 25, 56, 24, 90, 59, 57, 60, 60, 40, 51, 37, 58, 54, 83, 55, 56, 49];
const UPPER = [67, 64, 64, 65, 58, 55, 68, 68, 26, 34, 65, 47, 89, 73, 68, 61, 68, 64, 61, 53, 68, 64, 95, 66, 61, 54];
const DIGIT = [62, 32, 57, 57, 60, 57, 61, 48, 62, 61];
const OTHER: Record<string, number> = { " ": 19, ",": 18, ".": 22, "-": 32, "!": 26, "?": 39, "&": 71, ":": 23, ";": 21, "’": 18, "'": 18 };
/** A glyph the table does not know: as wide as an average capital. */
const UNKNOWN = 62;
/** Over-estimate on purpose: a line a little smaller than it could be beats one that clips. */
const SAFETY = 1.02;
/** The switch around the <emph> word: its padding (1.02em + .3em) and its left margin (.12em on phones). */
const PILL_EM = 1.44;

function advance(ch: string): number {
  const base = ch.normalize("NFD").charAt(0);
  const code = base.charCodeAt(0);
  if (code >= 97 && code <= 122) return LOWER[code - 97];
  if (code >= 65 && code <= 90) return UPPER[code - 65];
  if (code >= 48 && code <= 57) return DIGIT[code - 48];
  return OTHER[base] ?? UNKNOWN;
}

/** Estimated width of `text` in em. */
export function textEm(text: string): number {
  let hundredths = 0;
  for (const ch of text) hundredths += advance(ch);
  return hundredths / 100;
}

/** What the CSS needs to fit the headline (css/land-landing.css, `.h1`). */
export type HeadlineFit = {
  /** The widest line, as set: text and switch on one line (the look every locale gets when it fits). */
  line: number;
  /** The widest piece that cannot wrap: a line without the switch, or the switch on its own (phones may wrap before it). */
  unit: number;
};

const round = (em: number) => Math.ceil(em * SAFETY * 100) / 100;

/**
 * Measures the raw ICU message (`Your hiring,<br></br>on <emph>autopilot</emph>`):
 * each side of the <br>, with the <emph> word drawn as the switch.
 */
export function headlineFit(raw: string): HeadlineFit {
  let line = 0;
  let unit = 0;
  for (const part of raw.split(/<br\s*\/?>(?:<\/br>)?/i)) {
    const emph = /<emph>([\s\S]*?)<\/emph>/i.exec(part);
    const pill = emph ? textEm(emph[1]) + PILL_EM : 0;
    const rest = textEm(part.replace(/<emph>[\s\S]*?<\/emph>/gi, "").replace(/<[^>]+>/g, "").trim());
    line = Math.max(line, rest + pill + (emph && rest ? OTHER[" "] / 100 : 0));
    unit = Math.max(unit, rest, pill);
  }
  return { line: round(line), unit: round(unit) };
}

/**
 * The widest of `texts` in em, for a face set with a different tracking than the table's -.03em (About's display
 * lines use -.04em, the stamps +.07em). No safety margin: callers leave their own room.
 */
export function widestEm(texts: readonly string[], trackingEm = -0.03): number {
  let widest = 0;
  for (const text of texts) {
    const chars = Array.from(text).length;
    widest = Math.max(widest, textEm(text) + (trackingEm + 0.03) * chars);
  }
  return Math.ceil(widest * 100) / 100;
}

/** The text of each `<tag>…</tag>` in an ICU message, inner tags stripped. */
export function taggedTexts(raw: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi");
  return Array.from(raw.matchAll(re), (m) => m[1].replace(/<[^>]+>/g, ""));
}
