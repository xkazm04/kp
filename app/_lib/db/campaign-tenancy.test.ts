import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
// IMPORT ORDER IS LOAD-BEARING: unit-db must precede any module that reaches db-path.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { getCampaignPack, saveCampaignPack } from "./campaign.ts";

after(() => cleanupUnitDb());

// Tenant scope (E0 Phase 1) — source guard for campaign_packs (same shape as
// jds-tenancy.test.ts). Every SQL statement touching the table must filter/stamp
// workspace_id, so a future unscoped query fails CI instead of leaking a team's
// generated campaign packs across tenants.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "campaign.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

test("every campaign_packs query is workspace-scoped", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update)\s+campaign_packs\b/i.test(s));
  assert.ok(touching.length >= 2, `expected >=2 campaign_packs queries, found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(/workspace_id/.test(sql), `a campaign_packs query is NOT workspace-scoped:\n${sql.trim().slice(0, 200)}`);
  }
});

// Behavioral counterpart to the regex guard above. The scoping is only half the
// story: campaign_packs' PRIMARY KEY is (job_id, lang) — workspace_id was ALTERed in
// afterwards and is NOT part of it. So the upsert's `WHERE campaign_packs.workspace_id
// = excluded.workspace_id` guard (which correctly protects the FIRST team's pack) also
// blocks the SECOND team's INSERT, and SQLite reports that as 0 changes, not an error.
//
// Reachable on any shared corpus job (workspace_id NULL — ~100 seeded roles every
// tenant can open the Campaign tab on). Pre-fix, saveCampaignPack returned a
// CampaignPackRecord regardless: the recruiter saw the generated pack once in the
// response, and the Campaign tab read null forever after (campaign-run.ts's
// wait-or-leave contract explicitly promises the pack "persists in campaign_packs").
// A silent write loss under a green success is exactly the "never a green lie" rule.
test("a second team's pack for the same (job, lang) is refused loudly, not silently dropped", () => {
  saveCampaignPack("job-shared-corpus", "en", { variants: ["alpha"] }, "llm", "ws-a");
  assert.deepEqual(getCampaignPack("job-shared-corpus", "en", "ws-a")?.payload, { variants: ["alpha"] });

  assert.throws(
    () => saveCampaignPack("job-shared-corpus", "en", { variants: ["beta"] }, "llm", "ws-b"),
    /could not be saved/,
    "the blocked write must surface, not return a record as if it landed"
  );
  assert.equal(getCampaignPack("job-shared-corpus", "en", "ws-b"), null, "…and nothing was stored for ws-b");

  // The guard's original purpose still holds: team A's pack was never touched.
  assert.deepEqual(getCampaignPack("job-shared-corpus", "en", "ws-a")?.payload, { variants: ["alpha"] });

  // A same-team regenerate still overwrites in place (changes = 1, no throw).
  saveCampaignPack("job-shared-corpus", "en", { variants: ["alpha-v2"] }, "llm", "ws-a");
  assert.deepEqual(getCampaignPack("job-shared-corpus", "en", "ws-a")?.payload, { variants: ["alpha-v2"] });
});
