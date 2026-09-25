// The Sieve's component vocabulary, named once (the recipes.ts idiom).
//
// The flow's look lives in `sieve.css` (scoped under `.sv`); these constants are the
// class strings its controls wear. Naming them here is what makes a control a RECIPE
// rather than a hand-rolled one — the style ratchet (app/_components/ui/
// style-debt-rules.ts) reads a SCREAMING_CASE identifier in a className as recipe
// vocabulary — and it is the seam another surface uses to borrow the Sieve's pill
// button, its provenance tile or its switch without re-typing the strings.

export const SV_ROOT = "sv";

/** Pill buttons: outline (default), ink-filled, coral-filled, quiet outline. */
export const SV_BTN = "btn";
export const SV_BTN_PRIMARY = "btn primary";
export const SV_BTN_ACCENT = "btn accent";
export const SV_BTN_GHOST = "btn ghost";
export const SV_BTN_SM = "btn sm";
export const SV_BTN_SM_GHOST = "btn sm ghost";
export const SV_BTN_SM_ACCENT = "btn sm accent";
/** An underlined inline action inside a sentence. */
export const SV_LINK_BTN = "linkbtn";

/** A chip that is also a control (lift skills). */
export const SV_CHIP_BTN = "chip";
/** A filter chip with its count. */
export const SV_FCHIP = "fchip";

/** A skill tile in the "You" mesh — size is level, shape is provenance. */
export const SV_TILE = "tile";

/** Rows and cards that open a posting. */
export const SV_ROW = "prow";
export const SV_CARD = "tcard";
export const SV_CATCH_ROW = "crow";

/** The on/off switch (role="switch") and the tier-B terms door. */
export const SV_SWITCH = "switch";
export const SV_LOCK = "lockbtn";

/** A dismiss reason inside the decide bar's pop-over. */
export const SV_REASON = "reason";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
