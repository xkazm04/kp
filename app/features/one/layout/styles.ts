// The /one layout's paint (round 5: Sheets is the one layout; this folds in what it used from
// the round-3 Dense layout and the round-2 shared paint, which are gone). Compaction the
// finish hooks (finish.css) cannot reach is written as descendant variants on the layout
// root, so the shared panels (PanelFrame) are never forked. Every selector names a core
// `data-*` / role hook, not a class, wherever the core offers one; every colour resolves
// through a token — nothing here sets a colour.

// ── Faces + the composer ────────────────────────────────────────────────

/** The display face is the finish's (`--one-display-font`, default Bricolage). */
export const FACE_DISPLAY = "font-[family-name:var(--one-display-font)]";

/** The composer: the sticker's drawn outline WITHOUT the offset — the offset marks one
 *  thing per screen (the answer card), the outline only says "this is where you write". */
export const STICKER_COMPOSER =
  "rounded-[var(--one-radius)] border-2 border-[var(--one-sticker-border)] bg-white";

/** Hide a panel's session chrome (pin / focus / close) on a view the host draws on its own
 *  (the first beat's needs + first-need tables are not on the session's screen, so the
 *  chrome would act on nothing). The head's Console link is an <a>, it stays. */
export const NO_CHROME = "[&>div:first-child_button]:hidden!";

/** A key cap in the hint line: a quiet sunken box, the figure in the mono face. */
export const KEYCAP =
  "inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-stone-200 bg-stone-100 px-1 font-mono text-micro leading-none text-ink dark:border-stone-300";

// ── The dense compaction (the round-3 pick, kept as the layout's density) ──

/** Panel heads one step shorter (48 → 40px). The sticky column head (32px) is the
 *  `--one-colhead-h` hook in finish.css, so a role group head sticks right under it. */
const HEADS =
  "[&_[data-one-surface]>div:first-child]:min-h-10 [&_[data-one-surface]>div:first-child]:py-1";

/** A row is ONE line: the candidate's name, then its subline (role · age) on the same
 *  baseline. The name never truncates (it keeps its width); the subline gives way. */
const ONE_LINE_ROWS =
  "[&_[data-row]_[role=cell]>span>.flex-col]:flex-row [&_[data-row]_[role=cell]>span>.flex-col]:items-baseline [&_[data-row]_[role=cell]>span>.flex-col]:gap-2 [&_[data-row]_[role=cell]>span>.flex-col>span:first-child]:shrink-0 [&_[data-row]]:py-0.5";

/** The candidate tables' tracks, tightened: the name track takes every spare px, stage and
 *  score sit at their content's width. The core sets the template inline per row, so the
 *  override needs `!`; the four tracks are the core's own (name, stage, score, acts). Only
 *  while the table has 32rem of its own width (the `one-table` container, finish.css) —
 *  narrower, the core folds the row instead. */
const ENTRY_TRACKS =
  "@min-[32rem]/one-table:[&_[data-one-panel=decisionsQueue]_[role=row]]:grid-cols-[minmax(12rem,1fr)_7rem_7.5rem_5rem]! @min-[32rem]/one-table:[&_[data-one-panel=pipelineSlice]_[role=row]]:grid-cols-[minmax(12rem,1fr)_7rem_7.5rem_8rem]!";

/** The table foot (key hint) one step shorter. */
const FOOT = "[&_[data-role=one-table-foot]]:py-1.5";

/** The insight card's inner rhythm: a tighter stack, and the spread's columns drawn at 3/5
 *  of their bin so a tall card reads as a chart, not a wall of colour. */
const INSIGHT =
  "[&_[data-role=one-insight]]:gap-3 [&_[data-insight=facts]]:gap-x-4 [&_[data-insight=spread]_li>span:nth-child(2)>span]:mx-auto [&_[data-insight=spread]_li>span:nth-child(2)>span]:w-3/5";

/** Reduced motion: a row is always at rest. The root MotionConfig (reducedMotion "user")
 *  already drops the rows' rise and keeps only their fade; this keeps them fully still too
 *  (`!` beats framer's inline style). */
const ROWS_AT_REST = "motion-reduce:[&_[data-row]]:opacity-100! motion-reduce:[&_[data-row]]:transform-none!";

export const COMPACT = `${HEADS} ${ONE_LINE_ROWS} ${ENTRY_TRACKS} ${FOOT} ${INSIGHT} ${ROWS_AT_REST}`;

/** While a consent card is open: the card drops its suggestion and its spread may shrink —
 *  but never vanishes; the spread's own size container folds it into the one-line strip
 *  (PanelFrame InsightBody, `@container(max-height:6rem)`), so the card stays full. */
export const ASKING_TRIM =
  "[&_[data-insight=suggest]]:hidden [&_[data-insight=spread]]:min-h-12 [&_[data-insight=spread]]:overflow-hidden";

// ── The sheets ──────────────────────────────────────────────────────────

/** The main column's track: narrow with no sheet, a little wider under a list / letter
 *  sheet, half the body under a profile or the calendar (the list keeps the rest). */
export const COLS_NONE = "lg:grid-cols-[minmax(0,max(30rem,34vw))_minmax(0,1fr)]";
export const COLS_NARROW = "lg:grid-cols-[minmax(0,max(36rem,40vw))_minmax(0,1fr)]";
export const COLS_WIDE = "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]";

/** The calendar in a sheet: the free-time Book buttons fit a ~85px day column at 1280
 *  (the label is the time alone; tight padding, and the button may shrink to the column). */
export const CAL_BESIDE = "[&_[data-role=one-week]_[data-act=interview-book]]:px-1.5 [&_[data-role=one-week]_[data-act=interview-book]]:min-w-0";

/** The lower sheet's spine: the strip it peeks with, its name read upward. */
export const SPINE =
  "absolute inset-y-0 left-0 z-[1] flex w-6 items-center justify-center rounded-lg border border-stone-200 bg-stone-100 text-micro font-semibold text-steel outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-coral dark:rounded-2xl dark:border-2 dark:border-stone-300";

/** A person sheet's breadcrumb already names the tool and the person, so the tool panel's own
 *  head (the same words again) is dropped. */
export const NO_HEAD = "[&>[data-one-surface]>div:first-child]:hidden";

/** The letters and calendar sheets: the sheet's bar already names the view, so the panel's
 *  own title (and the count that reads as its suffix) is kept for assistive tech only; the
 *  head's state and Console door stay. */
export const NO_TITLE = "[&_[data-role=one-panel-title]]:sr-only [&_[data-role=one-panel-count]]:sr-only";
