// Split's paint — Greet's landing register carried forward, tokenized for BOTH themes.
//
// The faces come from Greet (one definition). The sticker is drawn ONLY on the answer's
// main surface — the summary card — which the core frames as a PANEL. A panel is one
// surface, so the sticker REPLACES the panel's outline rather than wrapping it in a second
// frame: the important modifiers win over PANEL's hairline whatever the stylesheet order.
export { FACE_BODY, FACE_DISPLAY, FACE_HAND, ARRIVE } from "../greet/styles";

/** The answer's main surface: ink outline + hard ink offset (Studio Light); the drawn
 *  stone-300 outline + the deep pop offset (Spark Dark). */
export const STICKER_SUMMARY =
  "rounded-xl! border-2! border-ink! shadow-[5px_5px_0_var(--color-ink)]! dark:rounded-2xl! dark:border-stone-300! dark:shadow-pop!";

/** The composer: the sticker's drawn outline WITHOUT the offset — the offset marks one
 *  thing per screen (the answer), the outline only says "this is where you write". */
export const STICKER_COMPOSER =
  "rounded-xl border-2 border-ink bg-white dark:rounded-2xl dark:border-stone-300";

/** On a short viewport (≤ 56rem tall: 1280x800) the summary keeps its headline + TWO rows,
 *  so the answer fits one sight without the main column scrolling; See all still names the
 *  full count and the side table carries every row. */
export const SHORT_TRIM =
  "[@media(max-height:56rem)]:[&_li:nth-child(n+3)]:hidden";

/** Hide a panel's session chrome (pin / focus / close). Two uses: a view the host draws on
 *  its own (the first beat's needs + first-need views are not on the session's screen, so
 *  the chrome would act on nothing), and the main column's summary, whose chrome lives once
 *  on the side table of the same view. The head's Console link is an <a>, it stays. */
export const NO_CHROME = "[&>div:first-child_button]:hidden!";

/** While a consent card is open the summary keeps only its head, headline figure and See all
 *  — and on a short viewport drops the head too (the headline's label names the view). */
export const ASKING_TRIM = "[&_ul]:hidden [@media(max-height:56rem)]:[&>div:first-child]:hidden!";
