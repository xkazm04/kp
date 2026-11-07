// Sheets' paint — what the dense finish (../dense/styles.ts) does not already say. Every
// colour resolves through a token; selectors name core `data-*` hooks, never classes.

/** The main column's track: Dense's width with no sheet, a little wider under a list /
 *  letter sheet, half the body under a profile or the calendar (the list keeps the rest). */
export const COLS_NONE = "lg:grid-cols-[minmax(0,max(30rem,34vw))_minmax(0,1fr)]";
export const COLS_NARROW = "lg:grid-cols-[minmax(0,max(36rem,40vw))_minmax(0,1fr)]";
export const COLS_WIDE = "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]";

/** The column change moves at the snap preset's pace; reduced motion = at once. */
export const COLS_MOVE = "transition-[grid-template-columns] duration-150 ease-out motion-reduce:transition-none";

/** A half-screen sheet is narrower than the tools' 900px two-column query, but the owner's
 *  ask is CV | score SIDE BY SIDE: force the profile pane's two columns (and the interview
 *  tool's), each half scrolling on its own. A local adapter — reported as a core debt. */
export const FORCE_TWO =
  "[&_[data-role=one-profile]>div]:h-full [&_[data-role=one-profile]>div]:grid-cols-2 [&_[data-role=one-profile]>div]:grid-rows-[minmax(0,1fr)] [&_[data-role=one-profile]>div>div:last-child]:overflow-y-auto [&_[data-role=one-interview]>div]:grid-cols-2";

/** The calendar in a half-screen sheet: the waiting list beside the week (the core puts it
 *  there only from 760px of the panel's own width). */
export const CAL_BESIDE =
  "[&_[data-role=one-calendar]>div:last-child]:grid-cols-[minmax(0,1fr)_12rem] [&_[data-role=one-calendar]>div:last-child]:grid-rows-1 [&_[data-role=one-calendar]>div:last-child>div:last-child]:border-t-0 [&_[data-role=one-calendar]>div:last-child>div:last-child]:border-l [&_[data-role=one-week]_[data-act=interview-book]]:px-1.5";

/** The lower sheet's spine: the strip it peeks with, its name read upward. */
export const SPINE =
  "absolute inset-y-0 left-0 z-[1] flex w-6 items-center justify-center rounded-lg border border-stone-200 bg-stone-100 text-micro font-semibold text-steel outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-coral dark:rounded-2xl dark:border-2 dark:border-stone-300";

/** A person sheet's breadcrumb already names the tool and the person, so the tool panel's own
 *  head (the same words again) is dropped. */
export const NO_HEAD = "[&>[data-one-surface]>div:first-child]:hidden";

/** The letters table in its sheet: the core's 5rem acts track holds the ✓ AND the Console
 *  door, which then spills over the date — a wider acts track, narrower revision column
 *  (a local adapter, reported). */
export const LETTERS_TRACKS = "[&_[data-one-panel=letters]_[role=row]]:grid-cols-[minmax(9rem,1fr)_5rem_7rem_9rem]!";
