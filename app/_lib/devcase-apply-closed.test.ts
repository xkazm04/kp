import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = readFileSync(path.join(ROOT, "app", "devcase", "apply", "[token]", "page.tsx"), "utf8");

test("the closed apply branch still mounts AiDisclosure with the server-resolved regime", () => {
  const start = src.indexOf('posting.status === "closed"');
  assert.ok(start >= 0, "closed branch must exist");
  const closed = src.slice(start, src.indexOf("const devCase", start));
  assert.match(closed, /<AiDisclosure[\s\S]*regimeId=\{compliance\.regimeId\}/);
  assert.match(closed, /retentionMonths=\{compliance\.retentionMonths\}/);
  assert.doesNotMatch(closed, /showDataConsent/);
});
