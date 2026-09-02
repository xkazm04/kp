// board-poll-carries-only-what-it-draws — the drag-move path.
//
// A move used to `await load()` in a `finally`, so every drop paid for a full
// re-read of the active board (every candidate's notes, GitHub evidence and
// approval detail) on top of the optimistic write, to learn the one thing the
// client already knew. The route hands the moved row back, so the success path
// applies THAT and only asks the events feed for its delta.
//
// A source guard rather than a behavioural test: moveEntry lives inside a React
// hook, and the contract worth pinning is structural — which branch reconciles and
// which does not. The pieces it depends on (the route's success body, the refusal
// codes) are pinned behaviourally by app/api/pipeline/pipeline-refusals-coded.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hook = readFileSync("app/features/hiring/pipeline/usePipelineBoardData.ts", "utf8");
const action = readFileSync("app/_lib/pipeline-entry-action.ts", "utf8");
const route = readFileSync("app/api/pipeline/route.ts", "utf8");

const moveEntry = hook.slice(hook.indexOf("const moveEntry = async"));

test("the success branch applies the server's row instead of refetching the board", () => {
  assert.match(moveEntry, /moved\?\.entry/, "the success path must read the entry the route returned");
  assert.match(moveEntry, /load\(\{ eventsOnly: true \}\)/, "only the events delta may follow a successful move");
});

test("a move no longer reconciles the whole board in a finally", () => {
  assert.doesNotMatch(moveEntry, /\}\s*finally\s*\{/, "the unconditional finally reconcile is what this removed");
});

test("a refusal still reconciles — a lost CAS means the board's view is suspect", () => {
  const refusal = moveEntry.slice(moveEntry.indexOf("if (!r.ok)"), moveEntry.indexOf("moved?.entry"));
  assert.match(refusal, /await load\(\)/, "the refusal branch must fall back to a full reconcile");
});

test("set_stage answers with the moved row, which is what the client applies", () => {
  assert.match(action, /return ok\(\{ entry: moved \}\);/, "the shared action must return the moved entry");
});

test("the list route projects through the board allowlist", () => {
  assert.match(route, /\.map\(boardEntryView\)/, "GET /api/pipeline must not serialize the store row verbatim");
});
