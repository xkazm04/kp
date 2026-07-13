import { test } from "node:test";
import assert from "node:assert/strict";
import { seedPreview } from "./CaseDetail.seed.ts";

// bug-ui-scan-2026-07-09 (dev-case-authoring-publishing #5). CaseDetail previewed the
// prose brief but never the materialized seed the candidate is actually handed. The
// preview collapses long files; these pin that truncation.

test("seedPreview: a short file is returned verbatim", () => {
  const short = "line1\nline2\nline3";
  assert.equal(seedPreview(short, 12), short);
});

test("seedPreview: a long file is truncated with a '+N more' trailer", () => {
  const contents = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join("\n");
  const out = seedPreview(contents, 12);
  // NON-VACUITY: rendering f.contents raw (the naive approach) would return all 20
  // lines and contain "line20"; the truncation must drop the tail and note the count.
  assert.ok(out.startsWith("line1\n"), "keeps the head");
  assert.ok(out.includes("line12"), "keeps exactly maxLines lines");
  assert.ok(!out.includes("line13"), "drops beyond maxLines");
  assert.ok(out.includes("+8 more lines"), "reports how many were hidden");
});

test("seedPreview: exactly maxLines lines is not truncated", () => {
  const contents = Array.from({ length: 12 }, (_, i) => `l${i}`).join("\n");
  assert.equal(seedPreview(contents, 12), contents);
  assert.ok(!seedPreview(contents, 12).includes("more line"));
});

test("seedPreview: a single hidden line uses the singular form", () => {
  const contents = Array.from({ length: 13 }, (_, i) => `l${i}`).join("\n");
  assert.ok(seedPreview(contents, 12).includes("+1 more line"));
  assert.ok(!seedPreview(contents, 12).includes("more lines"));
});
