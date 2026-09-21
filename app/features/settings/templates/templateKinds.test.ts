import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatTemplateName,
  isTemplateKind,
  parseTemplateName,
  TEMPLATE_BUCKETS,
  TEMPLATE_KINDS,
  UNSORTED,
} from "./templateKinds.ts";
import { insertToken } from "./templatesCaret.ts";

// The kind is a NAMING CONVENTION, not a column (see templateKinds.ts), so the
// parse/format pair is the only thing standing between a recruiter's grouping and
// a store that knows nothing about it. Pin the round trip.

test("format then parse is the identity for every real kind", () => {
  for (const kind of TEMPLATE_KINDS) {
    const stored = formatTemplateName(kind, "First-round invite");
    assert.equal(stored, `[${kind}] First-round invite`);
    assert.deepEqual(parseTemplateName(stored), { bucket: kind, title: "First-round invite" });
  }
});

test("the unsorted bucket writes a bare name, never an [unsorted] prefix", () => {
  assert.equal(formatTemplateName(UNSORTED, "Company standard"), "Company standard");
  assert.deepEqual(parseTemplateName("Company standard"), { bucket: UNSORTED, title: "Company standard" });
});

test("an unrecognised prefix is the author's own text and survives the round trip", () => {
  // Eating it would make this editor lossy for a name it did not write.
  assert.deepEqual(parseTemplateName("[draft] Something"), { bucket: UNSORTED, title: "[draft] Something" });
});

test("the prefix is case-insensitive and tolerant of the spacing people type", () => {
  assert.deepEqual(parseTemplateName("[Interview]   Invite"), { bucket: "interview", title: "Invite" });
  assert.deepEqual(parseTemplateName("  [OFFER] Cover note"), { bucket: "offer", title: "Cover note" });
});

test("the bucket vocabulary is the five kinds plus unsorted, with no duplicates", () => {
  assert.deepEqual([...TEMPLATE_BUCKETS], [...TEMPLATE_KINDS, UNSORTED]);
  assert.equal(new Set(TEMPLATE_BUCKETS).size, TEMPLATE_BUCKETS.length);
  for (const kind of TEMPLATE_KINDS) assert.equal(isTemplateKind(kind), true);
  for (const bad of ["Interview", "", "unsorted", null, undefined]) assert.equal(isTemplateKind(bad), false);
});

// A chip click must land where the caret is, replace a selection, and leave the
// caret after what it inserted — the three ways "insert a placeholder" goes wrong.
test("insertToken splices at the caret and reports the caret after the token", () => {
  assert.deepEqual(insertToken("Hi , welcome", "{{title}}", 3, 3), {
    next: "Hi {{title}}, welcome",
    caret: 12,
  });
});

test("insertToken replaces a selection", () => {
  assert.deepEqual(insertToken("Hi NAME!", "{{title}}", 3, 7), { next: "Hi {{title}}!", caret: 12 });
});

test("insertToken appends when the bounds are missing or out of range", () => {
  assert.deepEqual(insertToken("Hi", "{{title}}", null, null), { next: "Hi{{title}}", caret: 11 });
  assert.deepEqual(insertToken("Hi", "{{title}}", 99, 99), { next: "Hi{{title}}", caret: 11 });
});
