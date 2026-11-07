// Split's paint — the parts a finish re-skins through the hooks in finish.css rather than
// by forking markup. Every colour resolves through a token; no literal colour in this folder.
//
// Faces: the display face is the finish's (`--one-display-font`, default Bricolage); the
// hand note keeps the landing's Caveat (`--font-mk-hand`, put on the shell root by OneShell).

export const FACE_DISPLAY = "font-[family-name:var(--one-display-font)]";
export const FACE_HAND = "font-[family-name:var(--font-mk-hand)]";

/** The composer: the sticker's drawn outline WITHOUT the offset — the offset marks one
 *  thing per screen (the answer card), the outline only says "this is where you write". */
export const STICKER_COMPOSER =
  "rounded-[var(--one-radius)] border-2 border-[var(--one-sticker-border)] bg-white";

/** Hide a panel's session chrome (pin / focus / close) on a view the host draws on its own
 *  (the first beat's needs + first-need tables are not on the session's screen, so the
 *  chrome would act on nothing). The head's Console link is an <a>, it stays. */
export const NO_CHROME = "[&>div:first-child_button]:hidden!";

/** While a consent card is open the act in front is the card's, so the insight drops its
 *  suggestion and its spread gives way (it may shrink to nothing); on a short viewport (≤ 56rem tall:
 *  1280x800) the spread goes, so shape + facts + the consent card fit one sight. */
export const ASKING_TRIM =
  "[&_[data-insight=suggest]]:hidden [&_[data-insight=spread]]:min-h-14 [&_[data-insight=spread]]:overflow-hidden [@media(max-height:56rem)]:[&_[data-insight=spread]]:hidden";
