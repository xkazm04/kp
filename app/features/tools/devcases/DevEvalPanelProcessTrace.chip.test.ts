// The DECISIONS-log chip is tri-state: kept, missing, or could not be read.
// An unread repository tree is not a missing log (devcase-authenticity skips the
// penalty for it), so the chip must not paint it coral as if it were.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decisionsLogChip } from "./DevEvalPanelProcessTrace.chip.ts";

const ACCUSATORY = /\b(?:bg|text)-(?:coral|amber|red)\b/;

test("true: the log was kept, moss", () => {
  const chip = decisionsLogChip(true);
  assert.equal(chip.state, "kept");
  assert.equal(chip.key, "decisionsLogKept");
  assert.equal(chip.titleKey, null);
  assert.match(chip.className, /text-moss/);
});

test("false: a real absence stays 'missing' in coral", () => {
  const chip = decisionsLogChip(false);
  assert.equal(chip.state, "missing");
  assert.equal(chip.key, "decisionsLogMissing");
  assert.match(chip.className, /text-coral/);
});

test("null: the tree could not be read, a neutral chip with its own key", () => {
  const chip = decisionsLogChip(null);
  assert.equal(chip.state, "unread");
  assert.equal(chip.key, "decisionsLogUnread");
  assert.equal(chip.titleKey, "decisionsLogUnreadTitle");
  assert.doesNotMatch(chip.className, ACCUSATORY);
  assert.match(chip.className, /text-steel/);
});

test("undefined (field absent on the bundle) is not evidence of absence either", () => {
  const chip = decisionsLogChip(undefined);
  assert.equal(chip.state, "unread");
  assert.doesNotMatch(chip.className, ACCUSATORY);
});

test("every chip key exists in all four catalogs, and the unread copy is not 'missing'", () => {
  for (const locale of ["en", "cs", "de", "fr"]) {
    const cat = JSON.parse(readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8"));
    const trace = cat.devcase.processTrace;
    for (const v of [true, false, null] as const) {
      const chip = decisionsLogChip(v);
      assert.equal(typeof trace[chip.key], "string", `${locale}: ${chip.key}`);
      if (chip.titleKey) assert.equal(typeof trace[chip.titleKey], "string", `${locale}: ${chip.titleKey}`);
    }
    assert.notEqual(trace.decisionsLogUnread, trace.decisionsLogMissing, locale);
  }
});

test("the component renders through the helper, not a boolean ternary", () => {
  const src = readFileSync(join(process.cwd(), "app/features/tools/devcases/DevEvalPanelProcessTrace.tsx"), "utf8");
  assert.match(src, /decisionsLogChip\(/);
  assert.doesNotMatch(src, /decisionsLogPresent\s*\?/);
});
