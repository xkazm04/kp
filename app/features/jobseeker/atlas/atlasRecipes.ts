// The Atlas's component vocabulary, named once (the sieveRecipes.ts idiom).
//
// The Atlas's look lives in `atlas.css` (scoped under `.at`); these constants are the class
// strings its drawn controls wear. Naming them here is what makes a control a RECIPE rather
// than a hand-rolled one: the style ratchet (app/_components/ui/style-debt-rules.ts) reads a
// SCREAMING_CASE identifier in a className as recipe vocabulary.

export const AT_ROOT = "at k-kit";

/** A sector's name, set along the chart's edge. */
export const AT_SECTOR = "sec-lbl";
/** A rim arc's label (a gate, held at the door, waiting). */
export const AT_ARC = "arc-lbl";
/** The plate at the zenith while the dome is shut: the whole plate is a button. */
export const AT_PLATE = "plate-btn";
/** One of the top five, a card wired to its numbered star. */
export const AT_CARD = "t5-card";
/** A row of the "what opens the dome" list (a want, set or missing). */
export const AT_WANT = "want";
/** A round instrument on the deck (Lens / Spectrum / Bearing). */
export const AT_INST = "inst";
/** A round lens of the market (Sieve / Evening / Weigh / Sources). */
export const AT_LENS = "lens";
/** The quiet strip's small instrument. */
export const AT_INST_SMALL = "inst-s";
/** "All N scored": the dashed door to the catalogue. */
export const AT_MORE = "t5-more";
/** A rim chip on a phone. */
export const AT_CHIP = "rc";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
