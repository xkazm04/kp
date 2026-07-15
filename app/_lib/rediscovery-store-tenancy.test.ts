// Behavioral tenancy pins for the rediscovery store seam (direction 1). The source
// guards (rediscovery-tenancy.test.ts / campaign-tenancy.test.ts) assert the SQL is
// workspace-scoped; this drives the REAL modules against a throwaway SQLite file to
// pin that the three reads the callers were mis-threading actually ISOLATE by tenant:
//   - candidateOutcomes(workspaceId)      — prior-outcome labels for pickPrior
//   - record/listRediscoveryAlerts(ws)    — the standing silver-medalist feed
//   - save/getCampaignPack(ws)            — the per-job campaign pack
// so rediscovery in a non-default workspace can't read/write another tenant's rows.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

// db.ts transitively imports the "@/*" alias, extensionless TS siblings, and JSON
// files without an import attribute — none of which bare `node --test` resolves on
// its own. Same minimal hooks the other real-module tests use (rematch-source.test.ts).
const ROOT = new URL("../../", import.meta.url).href; // repo root (app/_lib/ -> ../../)
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if (spec.startsWith("@/")) spec = new URL(spec.slice(2), ROOT).href; // tsconfig "@/*"
    else if (
      (spec.startsWith("./") || spec.startsWith("../")) &&
      context.parentURL &&
      // Only rewrite OUR relative TS imports — never a dependency's internal relative
      // requires (better-sqlite3's `./database` etc.), which must resolve as plain CJS.
      !context.parentURL.includes("node_modules")
    ) {
      spec = new URL(spec, context.parentURL).href; // relative -> file: so we can test for .ts
    }
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && fs.existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts"; // extensionless import, e.g. "./pipeline-status"
    }
    return nextResolve(spec, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".json")) {
      const source = "export default " + fs.readFileSync(fileURLToPath(url), "utf8") + ";";
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// Point every store connection at a throwaway DB BEFORE importing them: db-path reads
// KP_DB_PATH at module load. node --test isolates each file in its own process.
const TMP = path.join(os.tmpdir(), `kp-rediscovery-store-tenancy-${process.pid}.sqlite`);
process.env.KP_DB_PATH = TMP;

const DEFAULT_WS = "workspace";
const WS_B = "team-beta";

const { createPipelineEntry, candidateOutcomes, saveCampaignPack, getCampaignPack } = await import("./db.ts");
const { recordRediscoveryAlerts, listRediscoveryAlerts } = await import("./rediscovery-alert-store.ts");

after(() => {
  for (const f of [TMP, `${TMP}-wal`, `${TMP}-shm`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* file locked / absent — fine */
    }
  }
});

test("candidateOutcomes isolates prior pipeline history by workspace", () => {
  // A candidate rejected from a role in team-beta only.
  const { entry } = createPipelineEntry({
    candidateId: "cand-onlyB",
    candidateLabel: "Cand Only B",
    jobId: "jobB1",
    jobTitle: "Beta Role",
    stage: "Screened",
    workspaceId: WS_B,
  });
  assert.ok(entry.id);

  // Read from team-beta: the outcome is there.
  assert.ok(candidateOutcomes(WS_B).has("cand-onlyB"), "team-beta sees its own candidate's history");
  // Read from the DEFAULT tenant (what an unscoped call resolves to): NOT visible —
  // the exact leak direction 1 fixes (pickPrior would otherwise read the wrong tenant).
  assert.equal(candidateOutcomes(DEFAULT_WS).has("cand-onlyB"), false, "default tenant does NOT see team-beta history");
});

test("rediscovery alerts record + list are isolated by workspace", () => {
  const rows = [
    { candidateId: "cand-B", label: "Cand B", archetype: "bau", score: 78, prior: { kind: "rejected", label: "Rejected · X", stage: "Screened", depth: 1 } },
  ];
  const added = recordRediscoveryAlerts("jobB1", "Beta Role", rows, WS_B);
  assert.equal(added, 1);

  // team-beta reads its alert back…
  const beta = listRediscoveryAlerts(WS_B);
  assert.equal(beta.length, 1);
  assert.equal(beta[0].candidateId, "cand-B");
  // …and the default tenant sees nothing (unscoped list would have leaked it).
  assert.deepEqual(listRediscoveryAlerts(DEFAULT_WS), []);
});

test("campaign packs save + get are isolated by workspace", () => {
  saveCampaignPack("jobB1", "en", { variants: ["beta-copy"] }, "deterministic", WS_B);

  const beta = getCampaignPack("jobB1", "en", WS_B);
  assert.ok(beta, "team-beta reads its own pack");
  assert.deepEqual(beta?.payload, { variants: ["beta-copy"] });
  // The default tenant has no pack for this job (unscoped get/save would collide).
  assert.equal(getCampaignPack("jobB1", "en", DEFAULT_WS), null);
});
