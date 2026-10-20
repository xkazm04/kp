// One `kp_fold` per connection (challenge-r09 cv-analyze-workspace/A).
//
// The process shares ONE better-sqlite3 connection (core.ts ensureDb), and two stores
// used to register their OWN `kp_fold` on it: jobs.ts (NFD, strip marks, lowercase,
// NULL passes through) and devcase-ledger.ts (toLocaleLowerCase, NULL -> ''). Each
// guarded only its own re-registration, so whichever store ran second replaced the
// other's function for the life of the process:
//   - ledger first, then jobs: the ledger needle was only lower-cased while its haystack
//     went through the stripping fold, so 'šablona' never matched 'Šablona testu';
//   - jobs first, then ledger: the jobs sort keys stopped folding diacritics and
//     `(key) IS NULL` saw '' instead of NULL, so missing locations sorted FIRST.
// text-fold.ts now owns the one definition, and both stores register it.
//
// unit-db.ts must stay the first project import (isolated throwaway DB). Each test
// below starts from a FRESH connection on the same file, so the two registration
// orders are really two process histories.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { ensureDb, type JobRecord } from "./db/core.ts";
import { createWorkspace } from "./db/workspaces.ts";
import { saveDevCase } from "./db/devcase.ts";
import { listCaseLedger } from "./db/devcase-ledger.ts";
import { listJobsPage } from "./db/jobs.ts";
import { insertJob } from "./job-ingest.ts";

after(() => cleanupUnitDb());

const holder = globalThis as typeof globalThis & { __kpDb?: { close(): void } };
/** Drop the process connection so the next ensureDb() opens a fresh one with no SQL
 *  functions registered: the state a new server process starts in. */
function freshConnection(): void {
  holder.__kpDb?.close();
  holder.__kpDb = undefined;
}

const W = createWorkspace("Fold team", "org-fold").id;
const caseId = saveDevCase(
  {
    need: { title: "Šablona testu", jdSlug: "sablona-testu" },
    analysis: null,
    role: { title: "Šablona role", seniority: "senior" },
    case: { title: "Šablona testu", coverProbes: [] },
  },
  W
).id;
for (const [id, location] of [["fold-brno", "Brno"], ["fold-none", null], ["fold-ostrava", "Ostrava"]] as const) {
  insertJob({ id, title: id, roleFamily: "fx-fold", location } as unknown as JobRecord, undefined, "published", W);
}

function foldOf(value: string | null): unknown {
  return (ensureDb().prepare(`SELECT kp_fold(?) AS v`).get(value) as { v: unknown }).v;
}

function assertOneFold(order: string): void {
  assert.equal(foldOf("Šablona"), "sablona", `${order}: kp_fold strips the diacritic`);
  assert.equal(foldOf(null), null, `${order}: kp_fold(NULL) IS NULL`);
  const hits = listCaseLedger(50, W, { q: "šablona" }).map((r) => r.id);
  assert.deepEqual(hits, [caseId], `${order}: the ledger finds 'Šablona testu' by 'šablona'`);
  for (const dir of ["asc", "desc"] as const) {
    const ids = listJobsPage({ roleFamily: "fx-fold", sort: "location", dir }, W).jobs.map((j) => j.id);
    assert.equal(ids.at(-1), "fold-none", `${order}: a NULL location sorts last (${dir})`);
  }
}

test("foldText: NFD, combining marks stripped, lower-cased; one definition for every surface", async () => {
  const { foldText } = await import("./text-fold.ts");
  assert.equal(foldText("Šablona"), "sablona");
  assert.equal(foldText("ČAPEK Říha"), "capek riha");
  assert.equal(foldText("Müller-Lüdenscheidt"), "muller-ludenscheidt");
  assert.equal(foldText(""), "");
});

test("registerKpFold registers once per connection and passes NULL through", async () => {
  const { registerKpFold } = await import("./text-fold.ts");
  freshConnection();
  const db = ensureDb();
  assert.equal(registerKpFold(db), db, "returns the connection it was given");
  registerKpFold(db);
  assert.equal(foldOf("Žluťoučký"), "zlutoucky");
  assert.equal(foldOf(null), null);
});

test("ledger registers first, then the jobs browse: one fold, both surfaces correct", () => {
  freshConnection();
  listCaseLedger(1, W);
  listJobsPage({ roleFamily: "fx-fold", sort: "location" }, W);
  assertOneFold("ledger->jobs");
});

test("jobs browse registers first, then the ledger: one fold, both surfaces correct", () => {
  freshConnection();
  listJobsPage({ roleFamily: "fx-fold", sort: "location" }, W);
  listCaseLedger(1, W);
  assertOneFold("jobs->ledger");
});
