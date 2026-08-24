import {
  CHAT_CHART_MAX_POINTS,
  CHAT_MAX_BLOCKS,
  CHAT_CHART_MAX_SERIES,
  CHAT_TABLE_MAX_COLUMNS,
  CHAT_TABLE_MAX_ROWS,
  type ChatBlock,
  type ChatChartBlock,
  type ChatTableBlock,
} from "@/app/_components/chat/chatBlockTypes";

// The TS half of the rich-turn contract (docs/features/companion/README.md).
//
// pipeline/jobfit/companion_blocks.py already validates every block against this
// schema, so this looks like belt-and-braces — it is not. Blocks cross TWO
// boundaries: a spawned process's stdout, and a `meta_json` TEXT column that was
// written by an older build of the app. Coercing here is what keeps a renderer
// from being handed `rows: undefined` by a row that predates this feature, which
// is a blank dock rather than a missing table.
//
// It also means the caps are enforced on the side that DRAWS them. The Python
// caps protect the model's output; these protect the pixels, and they are the
// same numbers because they are imported from the same module the renderers use.
//
// Dependency-free on purpose (no db, no next/server) so it is unit-testable —
// the same rule companion-turn.ts follows.

function str(value: unknown, limit: number): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

const MAX_TITLE = 80;
const MAX_LABEL = 40;
const MAX_CELL = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function coerceTable(raw: Record<string, unknown>): ChatTableBlock | null {
  if (!Array.isArray(raw.columns) || !Array.isArray(raw.rows)) return null;
  const columns = raw.columns
    .filter(isRecord)
    .map((column) => ({ key: str(column.key, MAX_LABEL), label: str(column.label, MAX_LABEL) }))
    .filter((column) => column.key && column.label)
    .slice(0, CHAT_TABLE_MAX_COLUMNS);
  if (columns.length === 0) return null;
  const rows = raw.rows
    .filter(isRecord)
    .map((row) => Object.fromEntries(columns.map((column) => [column.key, str(row[column.key], MAX_CELL)])))
    .filter((row) => Object.values(row).some(Boolean))
    .slice(0, CHAT_TABLE_MAX_ROWS);
  if (rows.length === 0) return null;
  const title = str(raw.title, MAX_TITLE);
  return { type: "table", columns, rows, ...(title ? { title } : {}) };
}

function coerceChart(raw: Record<string, unknown>): ChatChartBlock | null {
  const kind = raw.kind === "line" ? "line" : raw.kind === "bar" ? "bar" : null;
  if (!kind || !isRecord(raw.x) || !isRecord(raw.y) || !Array.isArray(raw.series)) return null;
  const xLabel = str(raw.x.label, MAX_LABEL);
  const yLabel = str(raw.y.label, MAX_LABEL);
  if (!xLabel || !yLabel || !Array.isArray(raw.x.values)) return null;
  const xValues = raw.x.values.slice(0, CHAT_CHART_MAX_POINTS).map((value) => str(value, MAX_LABEL));
  if (xValues.length === 0) return null;

  const series = raw.series
    .filter(isRecord)
    .map((entry) => ({
      label: str(entry.label, MAX_LABEL),
      values: Array.isArray(entry.values)
        ? entry.values.slice(0, CHAT_CHART_MAX_POINTS).filter((v): v is number => typeof v === "number" && Number.isFinite(v))
        : [],
    }))
    .filter((entry) => entry.label && entry.values.length > 0)
    .slice(0, CHAT_CHART_MAX_SERIES);
  if (series.length === 0) return null;

  // A bar may never be drawn against a tick that does not exist: the shortest of
  // the axis and every series decides the length, exactly as the producer does.
  const length = Math.min(xValues.length, ...series.map((entry) => entry.values.length));
  if (length < 1) return null;
  const title = str(raw.title, MAX_TITLE);
  return {
    type: "chart",
    kind,
    ...(title ? { title } : {}),
    x: { label: xLabel, values: xValues.slice(0, length) },
    y: { label: yLabel },
    series: series.map((entry) => ({ label: entry.label, values: entry.values.slice(0, length) })),
  };
}

/** Untrusted JSON in, renderable blocks out. Anything unrecognised is dropped
 *  silently HERE — the honest count of what the model got wrong is
 *  `blockErrors`, produced upstream where the raw fences were still visible;
 *  a block that dies at this boundary is a bug in one of the two schemas, not
 *  something to tell the operator about. */
export function coerceChatBlocks(raw: unknown): ChatBlock[] {
  if (!Array.isArray(raw)) return [];
  const blocks: ChatBlock[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const block = entry.type === "table" ? coerceTable(entry) : entry.type === "chart" ? coerceChart(entry) : null;
    if (block) blocks.push(block);
    if (blocks.length === CHAT_MAX_BLOCKS) break;
  }
  return blocks;
}

export type { ChatBlock };
