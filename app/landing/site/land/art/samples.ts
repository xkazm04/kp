/*
 * The landing's invented sample people and the figures drawn beside them. Named
 * constants, not JSX text: they are data the drawings carry (the footer states
 * that every person named on the page is an invented sample), and keeping them
 * here lets the landing's i18n lint stay clean without disables, as with the
 * chrome's BRAND (chrome/glyphs.ts).
 *
 * `tone` is the stamp colour of each CV card in the hero pile (the prototype's
 * inline `--tone`).
 */
export const SAMPLE = {
  jana: { name: "Jana N.", first: "Jana", initials: "JN", score: 87, tone: "#526b4f" },
  petr: { name: "Petr K.", score: 64, tone: "#a8842b" },
  alex: { name: "Alex T.", score: 31, tone: "#c44a3b" }
} as const;

/** The invented recruiter who signs every sample decision on the page. */
export const SIGNER = "M. Horáková";

/** Labels drawn inside the proof plates: the two sample candidates' letters and
 *  the two interview languages. Codes, not words, so they are not translated. */
export const PLATE_MARKS = { a: "A", b: "B", cz: "CZ", en: "EN" } as const;
