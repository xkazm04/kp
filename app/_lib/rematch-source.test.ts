// Pins what rematch does to the SOURCE pipeline entry (idea-9ad8a777). Rematch
// REDIRECTS a candidate to a better-fit role by opening a TARGET entry for another
// job; rematchSourceEntry must close the source to the terminal `rematched` status
// so the same person is never live + automatable in two funnels at once, and stamp
// the source→target link — while NEVER closing a placed (Hired) candidate and
// leaving an already-closed (rejected/declined) source's status intact. Drives the
// REAL db.ts against a throwaway SQLite file so a copied-out gate can't drift from
// the module.
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
import Database from "better-sqlite3";

// db.ts transitively imports the "@/*" alias, extensionless TS siblings, and JSON
// files without an import attribute — none of which the bare `node --test` runner
// resolves on its own. Install the same minimal hooks the other real-module tests
// use (see automation-fairness.test.ts) so we load the REAL db module.
const ROOT = new URL("../../", import.meta.url).href; // repo root (app/_lib/ -> ../../)
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if (spec.startsWith("@/")) spec = new URL(spec.slice(2), ROOT).href; // tsconfig "@/*"
    else if ((spec.startsWith("./") || spec.startsWith("../")) && context.parentURL) {
      spec = new URL(spec, context.parentURL).href; // relative -> file: so we can test for .ts
    }
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && fs.existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts"; // extensionless import, e.g. "./pipeline-status"
    }
    return nextResolve(spec, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".json")) {
      // Wrap JSON as an ES module so the missing `type: json` attribute is moot.
      const source = "export default " + fs.readFileSync(fileURLToPath(url), "utf8") + ";";
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// Point db.ts at a throwaway DB BEFORE importing it: db-path reads KP_DB_PATH at
// module load; ensureDb opens lazily on first use. node --test isolates each file in
// its own process, so this env mutation can't leak to other tests.
const TMP = path.join(os.tmpdir(), `kp-rematch-source-test-${process.pid}.sqlite`);
process.env.KP_DB_PATH = TMP;

const { createPipelineEntry, getPipelineEntry, actOnPipelineEntry, rematchSourceEntry } = await import("./db.ts");

// Read the source-side audit events via a separate read-only connection on the same
// file — exactly how the store and db.ts share kp.sqlite at runtime.
function events(entryId: string): { kind: string; detail: string | null }[] {
  const d = new Database(TMP, { readonly: true });
  const rows = d
    .prepare(`SELECT kind, detail FROM pipeline_events WHERE entry_id = ? ORDER BY id`)
    .all(entryId) as { kind: string; detail: string | null }[];
  d.close();
  return rows;
}

let n = 0;
// Seed one source entry with a unique candidate+job so the (candidate, job)
// idempotency key never collides across tests.
function seedSource(stage: string): { id: string; jobId: string } {
  n += 1;
  const jobId = `srcJob${process.pid}_${n}`;
  const { entry } = createPipelineEntry({
    candidateId: `c${process.pid}_${n}`,
    candidateLabel: `Cand ${n}`,
    jobId,
    jobTitle: `Source Role ${n}`,
    stage,
  });
  return { id: entry.id, jobId };
}

const TGT_ENTRY = "m-targetcand-targetjob";
const TGT_JOB = "targetJob";

after(() => {
  // Best-effort: the module connection stays open (no close hook); on Windows an
  // open SQLite file can't be unlinked, so swallow the error — the file is disposable.
  for (const f of [TMP, `${TMP}-wal`, `${TMP}-shm`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* file locked / absent — fine */
    }
  }
});

test("closes an ACTIVE source to the terminal `rematched` status and stamps the link", () => {
  const src = seedSource("Screened");
  const r = rematchSourceEntry(src.id, TGT_ENTRY, TGT_JOB);

  assert.deepEqual(r, { closed: true, outcome: "closed" });
  const row = getPipelineEntry(src.id);
  assert.equal(row?.status, "rematched"); // dropped out of the active board + automation
  assert.equal(row?.stage, "Screened"); // stage untouched — only status flips
  assert.equal(row?.approvalKind, null); // any pending approval cleared

  const link = events(src.id).find((e) => e.kind === "rematched");
  assert.ok(link, "a `rematched` link event is recorded on the source");
  // Concrete source→target link: job ids + the target entry id, so the redirect is
  // traceable both ways and the funnel never double-counts the person.
  assert.equal(link?.detail, `${src.jobId} -> ${TGT_JOB} (${TGT_ENTRY})`);
});

test("a second resolve on the now-closed source is a guarded no-op (re-run safety)", () => {
  const src = seedSource("Interview");
  rematchSourceEntry(src.id, TGT_ENTRY, TGT_JOB); // first close
  const r = rematchSourceEntry(src.id, TGT_ENTRY, TGT_JOB); // re-run

  assert.deepEqual(r, { closed: false, outcome: "already_terminal" });
  assert.equal(getPipelineEntry(src.id)?.status, "rematched"); // unchanged
});

test("an already-REJECTED source (re-engagement case) keeps its status, link only", () => {
  const src = seedSource("Screened");
  actOnPipelineEntry(src.id, "reject"); // company already passed on this role
  assert.equal(getPipelineEntry(src.id)?.status, "rejected");

  const r = rematchSourceEntry(src.id, TGT_ENTRY, TGT_JOB);
  assert.deepEqual(r, { closed: false, outcome: "already_terminal" });
  assert.equal(getPipelineEntry(src.id)?.status, "rejected"); // company-side close preserved
  assert.ok(events(src.id).some((e) => e.kind === "rematched"), "still links source→target for audit");
});

test("NEVER redirects a placed (Hired) candidate — and leaves it entirely untouched", () => {
  const src = seedSource("Hired"); // status stays 'active', stage 'Hired'
  const r = rematchSourceEntry(src.id, TGT_ENTRY, TGT_JOB);

  assert.deepEqual(r, { closed: false, outcome: "hired" });
  const row = getPipelineEntry(src.id);
  assert.equal(row?.status, "active"); // still placed — not flipped
  assert.equal(row?.stage, "Hired");
  assert.equal(events(src.id).some((e) => e.kind === "rematched"), false, "no link attaches to a hire");
});

test("a missing source is a safe no-op", () => {
  const r = rematchSourceEntry("does-not-exist", TGT_ENTRY, TGT_JOB);
  assert.deepEqual(r, { closed: false, outcome: "missing" });
});
