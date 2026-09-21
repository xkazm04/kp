// Pins the compare-interviews load-failure retry (scan-sweep jobs-candidates-compare).
// useJsonFetch already returns `reload`; the tab used to paint a coral line with no
// control. A .tsx cannot load under node:test, so this asserts the failure branch
// at the source the way jobsCoachPoolCap.test.ts pins the coach retry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "JobsCompareInterviews.tsx"), "utf8").replace(
  /\r\n/g,
  "\n"
);
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("compare load failure binds reload on a retry control", () => {
  assert.match(code, /const \{ data, error, reload \}/);
  assert.match(code, /if \(error\)/);
  assert.match(code, /onClick=\{reload\}/);
  assert.match(code, /t\("retry"\)/);
});
