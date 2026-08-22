// Pins the command palette's failed-search contract (searchResponseState).
//
// The bug: /api/search failing (a 401 after the session expired, a 500) raised the
// error banner but LEFT the previous query's hits in the list. paletteListView reads
// itemCount > 0 as "settled results", so nothing dimmed them, the highlight stayed on
// row 0, and Enter opened a candidate the recruiter had not typed. The loading path
// already forbids stale rows (workspacePaletteResults.test.ts); this pins the error
// path to the same rule.
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { searchResponseState } from "./useWorkspaceCommandPaletteSearch.ts";
import type { SearchHit } from "./workspaceCommandPaletteTypes.ts";

const HIT: SearchHit = { type: "profile", id: "c1", label: "Nováková", sub: "Backend" };

test("a successful response yields its results and no failure", () => {
  const state = searchResponseState(true, { results: [HIT] });
  assert.deepEqual(state, { hits: [HIT], failed: false });
});

test("a non-ok response CLEARS the hits — the prior query's rows are not this query's answer", () => {
  // The exact regression: the caller is holding [HIT] from "nov" when "nováková" 401s.
  const state = searchResponseState(false, { error: "Unauthorized", code: "UNAUTHORIZED" });
  assert.deepEqual(state.hits, [], "a failed search must not leave rows standing");
  assert.equal(state.failed, true);
});

test("a 200 carrying an error body is a failure too, and also clears", () => {
  const state = searchResponseState(true, { error: "SEARCH_FAILED" });
  assert.deepEqual(state.hits, []);
  assert.equal(state.failed, true);
});

test("an unparseable body is a failure, not an empty result set", () => {
  // r.json() rejected → body is null. Reporting "no matches" here would be the
  // failed-search-as-no-results lie.
  const state = searchResponseState(true, null);
  assert.deepEqual(state.hits, []);
  assert.equal(state.failed, true);
});

test("a malformed but successful body degrades to zero hits WITHOUT claiming failure", () => {
  // `results` missing or not an array: the server answered, it just carried nothing
  // usable. That is a genuine "no matches", so the palette may say so.
  for (const body of [{}, { results: null }, { results: "nope" }]) {
    const state = searchResponseState(true, body as { results?: unknown });
    assert.deepEqual(state.hits, [], `${JSON.stringify(body)} yields no hits`);
    assert.equal(state.failed, false, `${JSON.stringify(body)} is not a failure`);
  }
});
