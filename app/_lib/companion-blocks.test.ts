// The second gate on a rich turn. companion_blocks.py already validated these
// on the way out of the model, so the cases below are the ones that CANNOT come
// from the current producer: a `meta_json` row written by an older build, a
// hand-edited database, a future producer that drifts from the schema. Each one
// must degrade to "no block" rather than to a renderer holding `rows: undefined`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coerceChatBlocks, coerceChatBlocksCounted, renderableBlocks } from "./companion-blocks.ts";
import {
  CHAT_CHART_MAX_POINTS,
  CHAT_MAX_BLOCKS,
  CHAT_TABLE_MAX_COLUMNS,
  CHAT_TABLE_MAX_ROWS,
} from "@/app/_components/chat/chatBlockTypes";

const TABLE = {
  type: "table",
  title: "Top candidates",
  columns: [
    { key: "name", label: "Candidate" },
    { key: "fit", label: "Fit" },
  ],
  rows: [{ name: "A. Novak", fit: "82" }],
};

const CHART = {
  type: "chart",
  kind: "bar",
  x: { label: "Stage", values: ["Screen", "Interview"] },
  y: { label: "Candidates" },
  series: [{ label: "Active", values: [12, 5] }],
};

test("a well-formed pair survives the boundary unchanged", () => {
  const blocks = coerceChatBlocks([TABLE, CHART]);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], TABLE);
  assert.deepEqual(blocks[1], CHART);
});

test("anything that is not an array of objects yields no blocks", () => {
  for (const bad of [null, undefined, "table", 7, {}, [null], ["x"], [[]]]) {
    assert.deepEqual(coerceChatBlocks(bad), [], `expected [] for ${JSON.stringify(bad) ?? "undefined"}`);
  }
});

test("a table missing its rows or columns is dropped, not half-rendered", () => {
  assert.deepEqual(coerceChatBlocks([{ type: "table", columns: TABLE.columns }]), []);
  assert.deepEqual(coerceChatBlocks([{ type: "table", rows: TABLE.rows }]), []);
  assert.deepEqual(coerceChatBlocks([{ ...TABLE, columns: [] }]), []);
  assert.deepEqual(coerceChatBlocks([{ ...TABLE, rows: [{ other: "x" }] }]), []);
});

test("table caps are enforced on the side that draws them", () => {
  const columns = Array.from({ length: CHAT_TABLE_MAX_COLUMNS + 3 }, (_, i) => ({ key: `c${i}`, label: `C${i}` }));
  const rows = Array.from({ length: CHAT_TABLE_MAX_ROWS + 4 }, (_, i) => ({ c0: `r${i}` }));
  const [block] = coerceChatBlocks([{ type: "table", columns, rows }]);
  assert.equal(block?.type, "table");
  if (block?.type !== "table") return;
  assert.equal(block.columns.length, CHAT_TABLE_MAX_COLUMNS);
  assert.equal(block.rows.length, CHAT_TABLE_MAX_ROWS);
  // Every row is rebuilt against the surviving columns, so a renderer can index
  // by column key without checking whether the cell exists.
  assert.deepEqual(Object.keys(block.rows[0]), block.columns.map((c) => c.key));
});

test("a chart with an unknown kind or a non-numeric series is dropped", () => {
  assert.deepEqual(coerceChatBlocks([{ ...CHART, kind: "pie" }]), []);
  assert.deepEqual(coerceChatBlocks([{ ...CHART, series: [{ label: "Active", values: ["12", "5"] }] }]), []);
  assert.deepEqual(coerceChatBlocks([{ ...CHART, x: { label: "Stage", values: [] } }]), []);
  assert.deepEqual(coerceChatBlocks([{ ...CHART, y: {} }]), []);
});

test("a bar is never drawn against an axis tick that does not exist", () => {
  const [block] = coerceChatBlocks([
    { ...CHART, x: { label: "Stage", values: ["a", "b", "c"] }, series: [{ label: "Active", values: [1, 2] }] },
  ]);
  assert.equal(block?.type, "chart");
  if (block?.type !== "chart") return;
  assert.equal(block.x.values.length, 2);
  assert.equal(block.series[0].values.length, 2);
});

test("a chart past the point cap is truncated with its series", () => {
  const values = Array.from({ length: CHAT_CHART_MAX_POINTS + 5 }, (_, i) => `x${i}`);
  const numbers = values.map((_, i) => i);
  const [block] = coerceChatBlocks([{ ...CHART, x: { label: "Week", values }, series: [{ label: "A", values: numbers }] }]);
  assert.equal(block?.type, "chart");
  if (block?.type !== "chart") return;
  assert.equal(block.x.values.length, CHAT_CHART_MAX_POINTS);
  assert.equal(block.series[0].values.length, CHAT_CHART_MAX_POINTS);
});

test("a turn may not carry more blocks than the bubble can hold", () => {
  const many = Array.from({ length: CHAT_MAX_BLOCKS + 3 }, () => TABLE);
  assert.equal(coerceChatBlocks(many).length, CHAT_MAX_BLOCKS);
});

test("an unknown block type is skipped without taking the good ones with it", () => {
  const blocks = coerceChatBlocks([{ type: "timeline", rows: [] }, TABLE]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "table");
});

// ---- The counted discard (the half that was silent) -------------------------
// A block that satisfies companion_blocks.py and then dies HERE was dropped in
// silence and counted nowhere: `blockErrors` is produced only in Python. These
// pin the client's own count and its addition to the server's.

test("a malformed STORED block is counted, not silently dropped", () => {
  const { blocks, dropped } = coerceChatBlocksCounted([{ ...TABLE, rows: [] }, TABLE, "not even an object"]);
  assert.equal(blocks.length, 1);
  assert.equal(dropped, 2);
});

test("entries past the per-turn cap count as dropped too", () => {
  const many = Array.from({ length: CHAT_MAX_BLOCKS + 3 }, () => TABLE);
  const { blocks, dropped } = coerceChatBlocksCounted(many);
  assert.equal(blocks.length, CHAT_MAX_BLOCKS);
  assert.equal(dropped, 3);
});

test("the renderer's count is the server's PLUS what died in TS coercion", () => {
  const stale = renderableBlocks({ blocks: [TABLE, { type: "chart", kind: "pie" }], blockErrors: 2 });
  assert.equal(stale.blocks.length, 1);
  assert.equal(stale.blockErrors, 3, "2 the model got wrong upstream + 1 that did not survive here");
});

test("a turn with nothing wrong reports nothing wrong", () => {
  assert.deepEqual(renderableBlocks({ blocks: [TABLE] }), { blocks: coerceChatBlocks([TABLE]), blockErrors: 0 });
  assert.deepEqual(renderableBlocks(null), { blocks: [], blockErrors: 0 });
  assert.deepEqual(renderableBlocks(undefined), { blocks: [], blockErrors: 0 });
});

test("a nonsense server count is not trusted into the chip", () => {
  assert.equal(renderableBlocks({ blocks: [], blockErrors: -4 }).blockErrors, 0);
  assert.equal(renderableBlocks({ blocks: [], blockErrors: 1.7 }).blockErrors, 1);
});
