// The non-text half of a chat turn: what a reply can carry BESIDES prose.
//
// Deliberately generic and deliberately small. These are display shapes, not a
// companion vocabulary — "a table with up to four columns" and "a chart with up
// to two series" is the whole contract, so any future chat surface can emit one
// without importing anything companion-shaped. The producer side (the operator
// companion today) validates untrusted JSON into these types at its own
// boundary: app/_lib/companion-blocks.ts.
//
// THE CAPS ARE THE RENDERERS' REAL LIMITS, mirrored in
// pipeline/jobfit/companion_blocks.py. Blocks render FULL-BLEED under the bubble
// (ChatBlocks) across a 30rem dock, so the drawing gets the whole column rather
// than the 85 % the prose keeps — but a fifth column or a ninth bar still does
// not degrade, it stops being readable. Change one side and you must change the
// other.

/** How many blocks one turn may carry. Two is a comparison; five is a report,
 *  and a report does not belong inside a chat bubble. */
export const CHAT_MAX_BLOCKS = 2;

export const CHAT_TABLE_MAX_COLUMNS = 4;
export const CHAT_TABLE_MAX_ROWS = 8;
export const CHAT_CHART_MAX_POINTS = 8;
export const CHAT_CHART_MAX_SERIES = 2;

export type ChatTableBlock = {
  type: "table";
  title?: string;
  columns: { key: string; label: string }[];
  /** Cells are pre-stringified by the producer: the renderer must never have to
   *  decide how a number formats, because it does not know the locale rules the
   *  producer was reasoning in. An absent cell is "" and draws a placeholder. */
  rows: Record<string, string>[];
};

export type ChatChartBlock = {
  type: "chart";
  title?: string;
  kind: "bar" | "line";
  /** Category axis. `values.length` is authoritative — every series matches it. */
  x: { label: string; values: string[] };
  /** Value axis. Only its name: the scale is derived from the data. */
  y: { label: string };
  series: { label: string; values: number[] }[];
};

export type ChatBlock = ChatTableBlock | ChatChartBlock;

/** Every string the block renderers need. They live under `app/_components`,
 *  where a literal accessible name is a lint failure and the message namespace
 *  belongs to the caller. */
export type ChatBlockLabels = {
  /** Accessible fallback name for a table with no title. */
  table: string;
  /** Accessible fallback name for a chart with no title. */
  chart: string;
  /** Stands in for a cell the producer had no value for. */
  emptyCell: string;
};
