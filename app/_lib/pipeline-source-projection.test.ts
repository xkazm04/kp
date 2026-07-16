// variant-reaches-the-drawer — the board list payload (listPipeline → GET
// /api/pipeline → the drawer's entry) must carry the E5 campaign/creative
// attribution, not just the channel. Before this the SELECT omitted source_*, so a
// board-opened drawer never saw the origin line at all — only the [id] GET (SELECT *)
// did. This pins that listPipeline now projects sourceChannel/sourceCampaign/
// sourceVariant so the drawer's origin line resolves on the primary open path.
//
// unit-db.ts MUST be the first project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry, listPipeline } from "./db/pipeline.ts";

after(() => cleanupUnitDb());

test("listPipeline projects source channel/campaign/variant onto the board entry", () => {
  createPipelineEntry({
    candidateId: "cand-attr",
    candidateLabel: "Attri Bution",
    jobId: "jd-frontend",
    jobTitle: "Frontend Engineer",
    sourceChannel: "boards",
    sourceCampaign: "summer-2026",
    sourceVariant: "variant-b",
  });

  const entry = listPipeline().find((e) => e.candidateId === "cand-attr");
  assert.ok(entry, "the seeded entry rides the board list");
  assert.equal(entry!.sourceChannel, "boards", "channel rides the board payload");
  assert.equal(entry!.sourceCampaign, "summer-2026", "campaign rides the board payload (variant-reaches-the-drawer)");
  assert.equal(entry!.sourceVariant, "variant-b", "variant rides the board payload (variant-reaches-the-drawer)");
});

test("an unattributed entry projects null source fields (line reads exactly as before)", () => {
  createPipelineEntry({ candidateId: "cand-none", candidateLabel: "No Attr", jobId: "jd-frontend", jobTitle: "Frontend Engineer" });
  const entry = listPipeline().find((e) => e.candidateId === "cand-none");
  assert.ok(entry, "resolves");
  assert.equal(entry!.sourceChannel, null);
  assert.equal(entry!.sourceCampaign, null);
  assert.equal(entry!.sourceVariant, null);
});
