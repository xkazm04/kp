// Workbench's paint — a FORK of the dense compaction (variants/dense/styles.ts) plus the
// descendant variants the split needs, written on the layout root so the shared panels and
// tools (PanelFrame, ProfileTool, LetterTool, CalendarPanel) are never forked. Every selector
// names a core `data-*` / role hook. Nothing here sets a colour.

/** Panel heads one step shorter (48 → 40px). */
const HEADS =
  "[&_[data-one-surface]>div:first-child]:min-h-10 [&_[data-one-surface]>div:first-child]:py-1";

/** A row is ONE line: the name, then its subline on the same baseline (dense's rule). */
const ONE_LINE_ROWS =
  "[&_[data-row]_[role=cell]>span>.flex-col]:flex-row [&_[data-row]_[role=cell]>span>.flex-col]:items-baseline [&_[data-row]_[role=cell]>span>.flex-col]:gap-2 [&_[data-row]_[role=cell]>span>.flex-col>span:first-child]:shrink-0 [&_[data-row]]:py-0.5";

/** The table foot (key hint) one step shorter. */
const FOOT = "[&_[data-role=one-table-foot]]:py-1.5";

/** The insight card's inner rhythm (dense's). */
const INSIGHT =
  "[&_[data-role=one-insight]]:gap-3 [&_[data-insight=facts]]:gap-x-4 [&_[data-insight=spread]_li>span:nth-child(2)>span]:mx-auto [&_[data-insight=spread]_li>span:nth-child(2)>span]:w-3/5";

/** Reduced motion: a row is always at rest (dense's guard of the core race). */
const ROWS_AT_REST = "motion-reduce:[&_[data-row]]:opacity-100! motion-reduce:[&_[data-row]]:transform-none!";

export const WB_COMPACT = `${HEADS} ${ONE_LINE_ROWS} ${FOOT} ${INSIGHT} ${ROWS_AT_REST}`;

/** No person, no desk: the side is wide (dense's tracks). */
export const TRACKS_WIDE =
  "[&_[data-one-panel=decisionsQueue]_[role=row]]:grid-cols-[minmax(12rem,1fr)_7rem_7.5rem_5rem]! [&_[data-one-panel=pipelineSlice]_[role=row]]:grid-cols-[minmax(12rem,1fr)_7rem_7.5rem_8rem]! [&_[data-one-panel=letters]_[role=row]]:grid-cols-[minmax(12rem,1fr)_6rem_7.5rem_10rem]!";

/** Split: the list is the narrower half (34rem floor), so the candidate tables' fixed tracks
 *  step down and the name track keeps the spare px. The letters table (its own three tracks
 *  + acts) steps down the same way. The core's 32rem table floor still holds. */
export const TRACKS_NARROW =
  "[&_[data-one-panel=decisionsQueue]_[role=row]]:grid-cols-[minmax(9rem,1fr)_6.5rem_6.5rem_4.5rem]! [&_[data-one-panel=pipelineSlice]_[role=row]]:grid-cols-[minmax(9rem,1fr)_6.5rem_6.5rem_6rem]! [&_[data-one-panel=letters]_[role=row]]:grid-cols-[minmax(9rem,1fr)_5rem_6.5rem_9.5rem]!";

/** While a consent card is open the card drops its suggestion; its spread folds, never goes. */
export const ASKING_TRIM =
  "[&_[data-insight=suggest]]:hidden [&_[data-insight=spread]]:min-h-12 [&_[data-insight=spread]]:overflow-hidden";

/** The workbench is ~51–55% of the body (675px at 1280, 763px at 1440) — under the tools'
 *  900px container threshold, where they would stack. The owner asked for the CV and the
 *  score SIDE BY SIDE, so the workbench holds them in two columns at any lg width (each
 *  column scrolls on its own); same for the letter | thread and the interview's two halves.
 *  Below lg the core's stacking stands. */
export const TOOL_TWO_COLS = [
  "lg:[&_[data-role=one-profile]>div]:h-full lg:[&_[data-role=one-profile]>div]:grid-cols-2 lg:[&_[data-role=one-profile]>div]:grid-rows-[minmax(0,1fr)] lg:[&_[data-role=one-profile]>div>div:last-child]:overflow-y-auto",
  "lg:[&_[data-role=one-letter]>div]:h-full lg:[&_[data-role=one-letter]>div]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:[&_[data-role=one-letter]>div]:grid-rows-[minmax(0,1fr)] lg:[&_[data-role=one-letter]>div>div:last-child]:overflow-y-auto",
  "lg:[&_[data-role=one-interview]>div]:grid-cols-2",
].join(" ");

/** The Calendar DESK (left half): the week beside the waiting list at any lg width (the core
 *  puts them side by side only from 760px of the panel's own width). */
export const DESK_CALENDAR =
  "lg:[&_[data-role=one-calendar]>div:last-child]:grid-cols-[minmax(0,1fr)_14rem] lg:[&_[data-role=one-calendar]>div:last-child]:grid-rows-1 lg:[&_[data-role=one-calendar]>div:last-child>div:last-child]:border-t-0 lg:[&_[data-role=one-calendar]>div:last-child>div:last-child]:border-l";

/** The calendar as the LIST on the right (a person opened from the desk): the week over the
 *  waiting list, two equal halves that each scroll — so the waiting list never collapses
 *  under a tall week. */
export const SIDE_CALENDAR = "lg:[&_[data-role=one-calendar]>div:last-child]:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]";

/** A key cap in the hint line (dense's). */
export const KEYCAP =
  "inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-stone-200 bg-stone-100 px-1 font-mono text-micro leading-none text-ink dark:border-stone-300";

/** Inside the workbench the tool's own head ("Profile · Ana") repeats the workbench head —
 *  the strip names the tool, the head names the person and carries the Console door — so the
 *  tool's head row is dropped and its 40px go to the CV. */
export const TOOL_HEADLESS = "[&_[data-one-surface]>div:first-child]:hidden";
