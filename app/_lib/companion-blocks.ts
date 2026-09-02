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

/** What survived coercion, and how much did not. */
export type CoercedChatBlocks = { blocks: ChatBlock[]; dropped: number };

/**
 * Untrusted JSON in, renderable blocks out — AND a count of what died on the way.
 *
 * The count is the half this file used to be missing. The rule everywhere else
 * in a companion turn is that a dropped thing is admitted: `blockErrors` and
 * `actionErrors` both exist because "she showed me nothing" and "she tried and
 * it was malformed" are different facts. But `blockErrors` was produced ONLY in
 * Python (companion_cli.py), where the raw fences were still visible — so a
 * block that satisfied companion_blocks.py and then failed HERE was dropped in
 * silence and counted nowhere. That is not a hypothetical: this boundary exists
 * precisely because a `meta_json` row can have been written by an older build,
 * and a stale stored block is the exact input that survives one schema and not
 * the other. The renderer adds this count to the server's, so the chip tells the
 * truth about both halves.
 *
 * Entries past `CHAT_MAX_BLOCKS` count as dropped too: the cap is deliberate,
 * but from the operator's side "there was more and you are not seeing it" is the
 * same fact either way.
 */
export function coerceChatBlocksCounted(raw: unknown): CoercedChatBlocks {
  if (!Array.isArray(raw)) return { blocks: [], dropped: 0 };
  const blocks: ChatBlock[] = [];
  let dropped = 0;
  for (let i = 0; i < raw.length; i += 1) {
    if (blocks.length === CHAT_MAX_BLOCKS) {
      dropped += raw.length - i;
      break;
    }
    const entry = raw[i];
    const block = !isRecord(entry)
      ? null
      : entry.type === "table"
        ? coerceTable(entry)
        : entry.type === "chart"
          ? coerceChart(entry)
          : null;
    if (block) blocks.push(block);
    else dropped += 1;
  }
  return { blocks, dropped };
}

/** The blocks only — the shape `companion-run.ts` has always taken, kept so the
 *  fresh-spawn path is unchanged by the counting. */
export function coerceChatBlocks(raw: unknown): ChatBlock[] {
  return coerceChatBlocksCounted(raw).blocks;
}

/**
 * What a RENDERER should draw for one turn, and what its "dropped" chip should
 * say. One function so the dock and the voice strip cannot disagree about
 * either: the blocks are re-coerced at the point of drawing (a stored turn is
 * untrusted input however it was typed on the way in) and the drop count is the
 * server's count PLUS whatever did not survive here.
 */
export function renderableBlocks(
  meta: { blocks?: unknown; blockErrors?: number } | null | undefined
): { blocks: ChatBlock[]; blockErrors: number } {
  const { blocks, dropped } = coerceChatBlocksCounted(meta?.blocks);
  const reported = typeof meta?.blockErrors === "number" && meta.blockErrors > 0 ? Math.floor(meta.blockErrors) : 0;
  return { blocks, blockErrors: reported + dropped };
}

export type { ChatBlock };
