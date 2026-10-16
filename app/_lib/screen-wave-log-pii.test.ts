// screen-wave's server console.warn lines name the entry by id only: a candidate's name
// is PII and the console is one Sentry config away from third-party egress.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("no console.* line in screen-wave.ts interpolates candidateLabel", () => {
  const src = readFileSync(new URL("./screen-wave.ts", import.meta.url), "utf8");
  const logs = src.split("\n").filter((l) => /console\.(warn|error|log|info)\(/.test(l));
  assert.ok(logs.length >= 4, "the four warn lines are still there");
  for (const l of logs) assert.doesNotMatch(l, /candidateLabel|\.label/, l.trim());
});
