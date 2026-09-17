// GET /api/decisions/reconsider — listReconsiderQueue(50) used to silently
// truncate, so the UI treated items.length as the full auto-reject set and the
// safety valve could hide the rest of an irreversible wave. The envelope now
// carries truncated + total. Cap stays 50.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { actOnPipelineEntry, createPipelineEntry } from "../../../_lib/db/pipeline.ts";
import { GET } from "./route.ts";

after(() => cleanupUnitDb());

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, "route.ts"), "utf8").replace(/\r\n/g, "\n");

test("the reconsider envelope reports truncated and total, and does not raise the cap", () => {
  assert.match(src, /listReconsiderQueue\(50,/);
  assert.match(src, /truncated: total > 50/);
  assert.match(src, /total/);
  assert.doesNotMatch(src, /listReconsiderQueue\(5[1-9]/);
});

test("a 51-row auto-reject set reports truncated true, total 51, and items.length 50", async () => {
  for (let i = 0; i < 51; i++) {
    const { entry, created } = createPipelineEntry({
      candidateId: `recap-c${i}`,
      candidateLabel: `Reconsider ${i}`,
      jobId: `recap-job-${i}`,
      jobTitle: "Reconsider Role",
    });
    assert.equal(created, true);
    const rejected = actOnPipelineEntry(entry.id, "reject", "auto", { actor: "system" });
    assert.equal(rejected?.status, "rejected");
  }

  const res = await GET();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { items: unknown[]; truncated?: boolean; total?: number };
  assert.equal(body.items.length, 50, "the page stays capped at 50");
  assert.equal(body.truncated, true, "an over-cap set must say it was cut");
  assert.equal(body.total, 51, "total is the uncut auto-reject count");
});
