import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkIdFor, claimChunk, TAB_CHUNKS, type ChunkedTabId } from "./tabChunks.ts";
import { WORKSPACE_TAB_IDS } from "./tabs.ts";

// The prefetch bookkeeping had no test at all, and it is the one place where a
// wrong answer is invisible: warming the wrong module (or warming nothing) still
// renders, just slower, so only a test can tell the difference.

test("chunkIdFor maps history onto the Analyze chunk it actually renders", () => {
  assert.equal(chunkIdFor("history"), "analyze");
});

test("chunkIdFor returns null for a tab that owns no chunk", () => {
  // `history` is the only alias; every other id either owns a chunk or has none.
  const chunkless = WORKSPACE_TAB_IDS.filter((id) => chunkIdFor(id) === null);
  assert.deepEqual(chunkless, []);
});

test("every chunked id in the map is a real tab id", () => {
  const ids = new Set<string>(WORKSPACE_TAB_IDS);
  for (const id of Object.keys(TAB_CHUNKS)) assert.equal(ids.has(id), true, `${id} is not a tab`);
});

// One attempt per tab per document — the property prefetchTabChunk relies on to be
// safe on every hover.
test("claimChunk yields a chunk once and never again while it stays claimed", () => {
  const requested = new Set<ChunkedTabId>();
  assert.equal(claimChunk(requested, "jobs"), "jobs");
  assert.equal(claimChunk(requested, "jobs"), null);
  assert.deepEqual([...requested], ["jobs"]);
});

test("claimChunk collapses history and analyze onto ONE claim", () => {
  const requested = new Set<ChunkedTabId>();
  assert.equal(claimChunk(requested, "history"), "analyze");
  assert.equal(claimChunk(requested, "analyze"), null);
  assert.equal(requested.size, 1);
});

// A failed prefetch releases the claim, so the next hover retries rather than the
// tab staying permanently un-warmed for the life of the document.
test("releasing a failed claim lets the next hover try again", () => {
  const requested = new Set<ChunkedTabId>();
  const claimed = claimChunk(requested, "matrix");
  assert.ok(claimed);
  requested.delete(claimed);
  assert.equal(claimChunk(requested, "matrix"), "matrix");
});
