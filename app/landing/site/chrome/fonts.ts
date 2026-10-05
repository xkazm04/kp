import { Bricolage_Grotesque, Caveat, Figtree } from "next/font/google";

/*
 * The site's three faces (landing + About), loaded once and exposed as CSS
 * variables on the <MkRoot> wrapper. The scoped stylesheets read them through
 * their own tokens: --f-disp / --f-display -> --font-mk-disp, --f-body ->
 * --font-mk-body, --f-hand -> --font-mk-hand (see css/chrome.css,
 * css/about-tokens.css). latin-ext carries the Czech diacritics.
 *
 * Bricolage keeps its optical-size axis: the prototype asked Google Fonts for
 * `opsz 12..96`, and the display sizes are drawn with it.
 *
 * NO generated fallback face (here and in fontMono.ts). By default next/font adds
 * a metric-adjusted "<Face> Fallback" = `local(Arial)` with no unicode-range right
 * after the web font, so it catches every glyph the web font lacks. Figtree has
 * no → ← ▶ (chrome/glyphs.ts): they rendered in Arial, and every arrowed button
 * and the stepper arrows came out ~2px wider than the prototype, whose stack hands
 * them to the next declared face (Segoe UI, i.e. Segoe UI Black at weight 800, on
 * Windows). Two settings, because the bundlers differ: `adjustFontFallback: false`
 * is what webpack reads, and Turbopack (this canary) ignores it and only drops the
 * generated face when a manual `fallback` list is given. Each list is just the
 * FIRST family of the prototype's own stack for that token; the scoped CSS then
 * continues with the rest of the stack after the variable, so the effective list
 * is the prototype's (with that first family named twice, which is harmless).
 * Keep generics (`sans-serif`, `monospace`) out of these lists: a generic always
 * matches, so one here would hide the rest of the page's stack (About's body stack
 * is longer than the landing's).
 */
export const mkDisplay = Bricolage_Grotesque({
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
  variable: "--font-mk-disp",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Trebuchet MS"]
});

export const mkBody = Figtree({
  subsets: ["latin", "latin-ext"],
  variable: "--font-mk-body",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Segoe UI"]
});

export const mkHand = Caveat({
  subsets: ["latin", "latin-ext"],
  weight: ["600", "700"],
  variable: "--font-mk-hand",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Segoe Print"]
});

/** The class list MkRoot puts on the wrapper. */
export const MK_FONT_VARIABLES = `${mkDisplay.variable} ${mkBody.variable} ${mkHand.variable}`;
