// The Assignments ledger, served as ONE server row per case (challenge-r03
// devcase-workspace/A).
//
// The Cases table used to compute each row's stage, submission count and stall by
// joining three separately-bounded client lists: the case page (up to 500), the
// lifecycles (GET /api/devcase/lifecycle answers the 50 NEWEST only) and every posting
// with every submission inlined. Past fifty lifecycles a live assignment silently fell
// back to 'published'/'approved' and lost its stall chip. listCaseLedger joins in the
// store, over the whole workspace, and filters BEFORE the limit.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ensureDb } from "./core.ts";
import { createWorkspace } from "./workspaces.ts";
import {
  createLifecycle,
  createPosting,
  createSubmission,
  listCaseLedger,
  listLifecycles,
  saveDevCase,
  updateLifecycle,
} from "./devcase.ts";

after(() => cleanupUnitDb());

const W = createWorkspace("Ledger team W", "org-ledger-w").id;
const B = createWorkspace("Ledger team B", "org-ledger-b").id;

const probes = { coverProbes: [] };
function approveCase(title: string, ws: string, seniority = "senior"): string {
  return saveDevCase({ need: { title, jdSlug: `${title.toLowerCase().replace(/\W+/g, "-")}` }, analysis: null, role: { title: `${title} role`, seniority }, case: { title, ...probes } }, ws).id;
}

/** Place a lifecycle at a deterministic creation instant: createLifecycle stamps
 *  `now`, and sixty rows minted in one millisecond would tie on the sort key. */
function lifecycleAt(ws: string, isoCreated: string, patch: { caseId?: string; stage?: string } = {}): string {
  const lc = createLifecycle({ title: "run" }, true, "en", ws);
  if (patch.caseId || patch.stage) updateLifecycle(lc.id, { ...patch });
  ensureDb().prepare(`UPDATE dev_lifecycle SET created_at = ? WHERE id = ?`).run(isoCreated, lc.id);
  return lc.id;
}

// ---- case C: its lifecycle is the 60th-newest -------------------------------------
const C = approveCase("Old collecting assignment", W);
// The oldest of sixty: created on day 1; the fifty-nine newer ones follow it.
lifecycleAt(W, "2026-01-01T00:00:00.000Z", { caseId: C, stage: "collecting" });
for (let i = 2; i <= 60; i += 1) {
  lifecycleAt(W, `2026-01-${String(Math.min(i, 28)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00.000Z`);
}

test("a case whose lifecycle is past the 50-lifecycle window still reads its real stage", () => {
  // The premise witness: the window the studio used to join against does not hold it.
  assert.ok(!listLifecycles(50, W).some((lc) => lc.caseId === C), "the 60th-newest lifecycle is outside listLifecycles(50)");
  const row = listCaseLedger(50, W).find((r) => r.id === C);
  assert.ok(row, "case C is on the ledger");
  assert.equal(row.stage, "collecting");
});

test("no lifecycle: an open posting reads 'published', nothing at all reads 'approved'", () => {
  const posted = approveCase("Posted, no run", W);
  createPosting({ caseId: posted, channel: "careers", token: `tok-${posted}`, roleTitle: null, caseTitle: null });
  const bare = approveCase("Bare approval", W);
  const rows = listCaseLedger(500, W);
  assert.equal(rows.find((r) => r.id === posted)?.stage, "published");
  assert.equal(rows.find((r) => r.id === bare)?.stage, "approved");
});

test("submissions are counted across every posting of the case, with the stall inputs on the row", () => {
  const kase = approveCase("Busy assignment", W);
  const lcId = lifecycleAt(W, "2026-02-01T00:00:00.000Z", { caseId: kase, stage: "collecting" });
  const p1 = createPosting({ caseId: kase, channel: "careers", token: `a-${kase}`, roleTitle: null, caseTitle: null });
  const p2 = createPosting({ caseId: kase, channel: "linkedin", token: `b-${kase}`, roleTitle: null, caseTitle: null });
  for (let i = 0; i < 2; i += 1) createSubmission({ postingId: p1.id, candidateRef: `c${i}`, repoRef: `r${i}` });
  for (let i = 0; i < 3; i += 1) createSubmission({ postingId: p2.id, candidateRef: `d${i}`, repoRef: `s${i}` });
  const row = listCaseLedger(500, W).find((r) => r.id === kase);
  assert.ok(row);
  assert.equal(row.submissionCount, 5);
  assert.equal(row.lifecycleId, lcId);
  assert.equal(row.lifecycleCreatedAt, "2026-02-01T00:00:00.000Z");
  assert.ok(row.lifecycleUpdatedAt, "updated_at rides along: stallForCase ages a lifecycle from it");
  assert.equal(row.jdSlug, "busy-assignment", "the picked JD survives the projection");
});

test("the ledger is a projection: no design JSON on the row", () => {
  const row = listCaseLedger(1, W)[0] as Record<string, unknown>;
  for (const key of ["need", "analysis", "role", "case", "scenario", "seed"]) {
    assert.ok(!(key in row), `${key} must not ride the ledger row`);
  }
});

test("another workspace's case never reaches W's ledger, and W's never reaches B's", () => {
  const foreign = approveCase("Team B secret", B);
  const lcB = lifecycleAt(B, "2026-03-01T00:00:00.000Z", { caseId: foreign, stage: "ranked" });
  assert.ok(lcB);
  assert.ok(!listCaseLedger(500, W).some((r) => r.id === foreign));
  const bRows = listCaseLedger(500, B);
  assert.deepEqual(bRows.map((r) => r.id), [foreign]);
  assert.equal(bRows[0].stage, "ranked");
  // A W lifecycle pointed at B's case (a corrupt cross-link) must not paint B's stage.
  lifecycleAt(W, "2026-03-02T00:00:00.000Z", { caseId: foreign, stage: "closed" });
  assert.equal(listCaseLedger(500, B)[0].stage, "ranked");
});

test("filters apply before the limit: stage, seniority and a folded title", () => {
  const ws = createWorkspace("Ledger filter team", "org-ledger-filter").id;
  for (let i = 0; i < 12; i += 1) {
    const id = approveCase(`Filler ${i}`, ws, "junior");
    lifecycleAt(ws, `2026-04-${String(i + 2).padStart(2, "0")}T00:00:00.000Z`, { caseId: id, stage: "ranked" });
  }
  // Oldest cases, so an unfiltered page of 5 would not reach them.
  const match = approveCase("Šablona API", ws, "senior");
  lifecycleAt(ws, "2026-04-01T00:00:00.000Z", { caseId: match, stage: "collecting" });
  ensureDb().prepare(`UPDATE dev_cases SET created_at = ? WHERE id = ?`).run("2020-01-01T00:00:00.000Z", match);

  assert.ok(!listCaseLedger(5, ws).some((r) => r.id === match), "unfiltered, the match sits past the page");
  assert.deepEqual(listCaseLedger(5, ws, { stage: "collecting" }).map((r) => r.id), [match]);
  assert.deepEqual(listCaseLedger(5, ws, { seniority: "senior" }).map((r) => r.id), [match]);
  // Case-folded beyond ASCII: SQLite's lower() leaves 'Š' alone, the ledger does not.
  assert.deepEqual(listCaseLedger(5, ws, { q: "šablona" }).map((r) => r.id), [match]);
  assert.deepEqual(listCaseLedger(5, ws, { q: "  ŠABLONA api " }).map((r) => r.id), [match]);
  assert.deepEqual(listCaseLedger(5, ws, { q: "role" }).length, 5, "the role title is searched too");
  assert.deepEqual(listCaseLedger(50, ws, { stage: "collecting", seniority: "junior" }), []);
});

test("the facets answer for the whole workspace, not the page", async () => {
  const { listCaseLedgerFacets } = await import("./devcase.ts");
  const facets = listCaseLedgerFacets(W);
  assert.ok(facets.stages.includes("collecting"));
  assert.ok(facets.stages.includes("published"));
  assert.ok(facets.stages.includes("approved"));
  assert.ok(!facets.stages.includes("ranked"), "B's stage is not W's facet");
  assert.deepEqual(facets.seniorities, ["senior"]);
});

test("every ledger statement scopes each dev table it reads to the caller's workspace", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "devcase.ts"), "utf8");
  const blocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]).filter((s) => /\bdev_lifecycle\s+l\b/.test(s));
  assert.ok(blocks.length >= 1, "the ledger CTE is in devcase.ts");
  for (const sql of blocks) {
    // lifecycles, postings (stage fallback + counts) and the cases themselves.
    for (const alias of ["l", "p", "c"]) {
      assert.match(sql, new RegExp(`\\b${alias}\\.workspace_id\\s*=\\s*\\?`), `alias ${alias} is not tenant-filtered:\n${sql}`);
    }
  }
});
