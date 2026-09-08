// The empty board's move ORDER is a product decision with a dependency behind it
// (see pipelineEmptyMoves.ts), and it is the one thing about this surface that a
// redesign must not quietly re-shuffle: the previous empty state led with
// channels and pointed "add a candidate manually" at a tab that cannot add one.
// So the sequence, the tabs it names, and the four-locale copy behind each move
// are pinned here rather than living only in whichever variant is on screen.
//
//   node scripts/run-unit-tests.mjs "app/features/hiring/pipeline/**/*.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EMPTY_MOVES, FIRST_MOVE } from "./pipelineEmptyMoves.ts";
import { WORKSPACE_TAB_IDS } from "../../../shell/tabs.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const LOCALES = ["en", "cs", "de", "fr"];

test("the moves run role -> candidates -> channels, on the tabs that can do them", () => {
  assert.deepEqual(
    EMPTY_MOVES.map((m) => [m.key, m.tab]),
    [
      ["role", "intake"],
      ["candidates", "analyze"],
      ["channels", "channels"],
    ]
  );
  // The dependency the product itself enforces: a board lane is keyed by a job,
  // and Analyze cannot add to the pipeline until the run is tagged to a saved JD.
  const keys = EMPTY_MOVES.map((m) => m.key);
  assert.ok(keys.indexOf("role") < keys.indexOf("candidates"), "the role is written before candidates are added");
  assert.ok(keys.indexOf("candidates") < keys.indexOf("channels"), "channels are the next choice, not the prerequisite");
  assert.equal(FIRST_MOVE.key, "role");
});

test("every move names a real workspace tab and has a unique key", () => {
  const ids = new Set<string>(WORKSPACE_TAB_IDS);
  for (const move of EMPTY_MOVES) assert.ok(ids.has(move.tab), `unknown tab ${move.tab}`);
  assert.equal(new Set(EMPTY_MOVES.map((m) => m.key)).size, EMPTY_MOVES.length);
});

test("channels is the only optional move", () => {
  assert.deepEqual(
    EMPTY_MOVES.filter((m) => m.optional).map((m) => m.key),
    ["channels"]
  );
});

test("every move carries a title in all four locales, and nothing else", () => {
  for (const locale of LOCALES) {
    const catalog = JSON.parse(readFileSync(resolve(REPO_ROOT, "messages", `${locale}.json`), "utf8"));
    const moves = catalog?.pipeline?.emptyState?.moves;
    assert.ok(moves, `${locale}: pipeline.emptyState.moves is missing`);
    for (const move of EMPTY_MOVES) {
      const value = moves?.[move.key]?.title;
      assert.equal(typeof value, "string", `${locale}: pipeline.emptyState.moves.${move.key}.title is missing`);
      assert.ok((value as string).trim().length > 0, `${locale}: ${move.key}.title is empty`);
      // The card IS the button and the title IS its accessible name, so the
      // explanatory `body` and the separate `action` label were deleted rather
      // than hidden. A locale that still carries one is an orphan the parity
      // gate cannot see (it only compares the four catalogs against each other).
      assert.deepEqual(
        Object.keys(moves[move.key]).sort(),
        ["title"],
        `${locale}: pipeline.emptyState.moves.${move.key} carries a key beyond title`
      );
    }
  }
});
