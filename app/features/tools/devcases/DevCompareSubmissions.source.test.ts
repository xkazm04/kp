import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "DevCompareSubmissions.tsx"), "utf8");

test("the compare matrix labels authenticityBand, including suspect leaders", () => {
  assert.match(src, /col\.authenticityBand/);
  assert.match(src, /band\.\$\{band\}/);
  assert.match(src, /band\.unscored/);
});

test("a truncated compare can expand past the transfer tail", () => {
  assert.match(src, /showAll \? 0 : 5/);
  assert.match(src, /t\("showAll"/);
  assert.match(src, /t\("showTop"/);
});
