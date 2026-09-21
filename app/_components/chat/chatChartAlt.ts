import type { ChatBlockLabels, ChatChartBlock } from "./chatBlockTypes";

/*
 * Text alternative for a chat chart. The SVG is geometry; AT needs the numbers.
 * Caps stay at two series × eight points (chatBlockTypes) — this just reads them.
 */

export type ChartAlt = {
  caption: string;
  columns: string[];
  /** One row per category: [category, ...series values as strings]. */
  rows: string[][];
};

export function chartAlt(block: ChatChartBlock, labels: ChatBlockLabels): ChartAlt {
  return {
    caption: block.title ?? labels.chart,
    columns: [block.x.label, ...block.series.map((entry) => entry.label)],
    rows: block.x.values.map((category, index) => [
      category,
      ...block.series.map((entry) => {
        const value = entry.values[index];
        return value === undefined ? labels.emptyCell : String(value);
      }),
    ]),
  };
}

/** Series values in table-reading order (row by row, skipping the category cell). */
export function chartAltValues(block: ChatChartBlock, labels: ChatBlockLabels): string[] {
  return chartAlt(block, labels).rows.flatMap((row) => row.slice(1));
}
