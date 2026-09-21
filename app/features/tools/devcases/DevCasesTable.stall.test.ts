import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stallForCase } from "./DevCasesTable.stall.ts";

const NOW = Date.parse("2026-06-14T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const DIR = path.dirname(fileURLToPath(import.meta.url));

test("a stalled collecting row shows the stall chip; a row with a submission does not", () => {
  const empty = stallForCase(
    { stage: "collecting", updatedAt: daysAgo(10), createdAt: daysAgo(12), submissionCount: 0 },
    NOW,
  );
  assert.equal(empty.stalled, true);
  assert.equal(empty.ageDays, 10);

  const withSub = stallForCase(
    { stage: "collecting", updatedAt: daysAgo(10), createdAt: daysAgo(12), submissionCount: 1 },
    NOW,
  );
  assert.equal(withSub.stalled, false);
});

test("CasesTable mounts the SLA chip from stallForCase and the existing stalled* catalog", () => {
  const src = readFileSync(path.join(DIR, "DevCasesTable.tsx"), "utf8");
  assert.match(src, /stallForCase/);
  assert.match(src, /tLife\("stalledBadge"/);
  assert.match(src, /tLife\("stalledTitle"/);
});
