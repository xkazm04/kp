// Dense's paint — compaction the hooks (finish.css) cannot reach, written as descendant
// variants on the layout root so the shared panels (PanelFrame) are never forked. Every
// selector names a core `data-*` / role hook, not a class, wherever the core offers one.
//
// Colour and face still resolve through tokens; nothing here sets a colour.

/** Panel heads one step shorter (48 → 40px) and the sticky column head 36 → 32px. */
const HEADS =
  "[&_[data-one-surface]>div:first-child]:min-h-10 [&_[data-one-surface]>div:first-child]:py-1 [&_[data-role=one-table]_[role=row]:not([data-row])]:h-8";

/** A row is ONE line: the candidate's name, then its subline (role · age) on the same
 *  baseline. The name never truncates (it keeps its width); the subline gives way. With
 *  the 36px `--one-row-h` that is what puts ~18 rows in sight instead of ~13. */
const ONE_LINE_ROWS =
  "[&_[data-row]_[role=cell]>span>.flex-col]:flex-row [&_[data-row]_[role=cell]>span>.flex-col]:items-baseline [&_[data-row]_[role=cell]>span>.flex-col]:gap-2 [&_[data-row]_[role=cell]>span>.flex-col>span:first-child]:shrink-0 [&_[data-row]]:py-0.5";

/** The candidate tables' tracks, tightened: the name track takes every spare px (so the
 *  role subline stops truncating early), stage and score sit at their content's width. The
 *  core sets the template inline per row, so the override needs `!`; the four tracks are
 *  the core's own (name, stage, score, acts — `useEntryCols` + each panel's `actsTrack`). */
const ENTRY_TRACKS =
  "[&_[data-one-panel=decisionsQueue]_[role=row]]:grid-cols-[minmax(12rem,1fr)_7rem_7.5rem_5rem]! [&_[data-one-panel=pipelineSlice]_[role=row]]:grid-cols-[minmax(12rem,1fr)_7rem_7.5rem_8rem]!";

/** The table foot (key hint) one step shorter. */
const FOOT = "[&_[data-role=one-table-foot]]:py-1.5";

/** The insight card's inner rhythm: a tighter stack, and the spread's columns drawn at 3/5
 *  of their bin so a tall card reads as a chart, not a wall of colour. */
const INSIGHT =
  "[&_[data-role=one-insight]]:gap-3 [&_[data-insight=facts]]:gap-x-4 [&_[data-insight=spread]_li>span:nth-child(2)>span]:mx-auto [&_[data-insight=spread]_li>span:nth-child(2)>span]:w-3/5";

/** Reduced motion: a row is always at rest. Guards a CORE race (reported): a freshly mounted
 *  table reads `useReducedMotion()` as false on its first render, mounts its rows with the
 *  stagger's `initial` (opacity 0), and when the hook flips to true `rowStagger` returns null,
 *  the `animate` prop disappears and framer leaves the rows at opacity 0. `!` beats framer's
 *  inline style. */
const ROWS_AT_REST = "motion-reduce:[&_[data-row]]:opacity-100! motion-reduce:[&_[data-row]]:transform-none!";

export const DENSE_COMPACT = `${HEADS} ${ONE_LINE_ROWS} ${ENTRY_TRACKS} ${FOOT} ${INSIGHT} ${ROWS_AT_REST}`;

/** While a consent card is open: the card drops its suggestion and its spread may shrink —
 *  but never vanishes. Split hides it on a short viewport, which left a dead band inside
 *  the card at 1280x800; here the spread's own size container folds it into the one-line
 *  strip (PanelFrame InsightBody, `@container(max-height:6rem)`), so the card stays full. */
export const DENSE_ASKING_TRIM =
  "[&_[data-insight=suggest]]:hidden [&_[data-insight=spread]]:min-h-12 [&_[data-insight=spread]]:overflow-hidden";

/** A key cap in the hint line: a quiet sunken box, the figure in the mono face. */
export const KEYCAP =
  "inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-stone-200 bg-stone-100 px-1 font-mono text-micro leading-none text-ink dark:border-stone-300";
