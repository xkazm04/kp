// The CV designer's control vocabulary, named once (the recipes.ts / sieveRecipes.ts
// idiom). The look lives in `cv.css` under `.cvdesk`; naming the class strings here is
// what makes each control a RECIPE the style ratchet recognises, and the seam another
// surface would borrow a layout thumbnail or an accent dot through.

/** A layout choice: a schematic of the page above its name (aria-pressed). */
export const CV_TEMPLATE_BTN = "cvdesk-tpl";
/** An accent choice: a colour dot with an accessible name (aria-pressed). */
export const CV_ACCENT_BTN = "cvdesk-dot";
/** A quiet underlined action inside a line of text. */
export const CV_LINK_BTN = "cvdesk-link";
/** A tailoring choice or toggle: a quiet pill (aria-pressed), the target titles and the
 *  "Seeking" / one-line options beside them. */
export const CV_OPTION_BTN = "cvdesk-opt";
