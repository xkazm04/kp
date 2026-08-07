// bug-ui-scan-2026-07-09 (architecture-diagrams #4). These guard the pure a11y
// logic pulled out of PlantUml.tsx (the .tsx can't load under `node --test`).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { clickableNodeAria, diagramSvgRole } from "./a11y.ts";

test("clickableNodeAria collapses a multi-line label into one accessible name", () => {
  // The pre-fix node had NO aria-label — its only name was the split tspans, read
  // as disconnected fragments. The fix names it as one line.
  const { "aria-label": label } = clickableNodeAria("POST /api/jobs/ingest\njob-ingest.ts", false);
  assert.equal(label, "POST /api/jobs/ingest job-ingest.ts");
  assert.ok(!label.includes("\n"), "accessible name must not contain a raw newline");
});

test("clickableNodeAria trims and squeezes whitespace around the break", () => {
  assert.equal(clickableNodeAria("  a  \n  b  ", false)["aria-label"], "a b");
});

test("clickableNodeAria exposes the active/open state as aria-pressed", () => {
  // The coral 'active' border had no programmatic equivalent pre-fix.
  assert.equal(clickableNodeAria("Match", true)["aria-pressed"], true);
  assert.equal(clickableNodeAria("Match", false)["aria-pressed"], false);
});

test("diagramSvgRole is 'group' when interactive, 'img' otherwise", () => {
  // role="img" collapses child buttons in AT; an interactive funnel must be a group.
  assert.equal(diagramSvgRole(true), "group");
  assert.equal(diagramSvgRole(false), "img");
});
