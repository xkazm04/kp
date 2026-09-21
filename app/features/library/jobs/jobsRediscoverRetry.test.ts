// Pins the on-demand rediscovery load-failure retry (scan-sweep jobs-rediscovery).
// The standing feed already retries a failed GET; this panel ignored `reload`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "JobsRediscoverPanel.tsx"), "utf8").replace(
  /\r\n/g,
  "\n"
);
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("rediscover load failure binds reload on a retry control", () => {
  assert.match(code, /const \{ data: body, error, reload \}/);
  assert.match(code, /if \(error\)/);
  assert.match(code, /onClick=\{reload\}/);
  assert.match(code, /t\("retry"\)/);
});
