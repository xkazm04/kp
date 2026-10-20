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
  listLifecycles,
  saveDevCase,
  setPostingStatus,
  updateLifecycle,
} from "./devcase.ts";
import { listCaseLedger, listCaseLedgerFacets } from "./devcase-ledger.ts";
import { lifecycleStall } from "../devcase-sla.ts";

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

test("the facets answer for the whole workspace, not the page", () => {
  const facets = listCaseLedgerFacets(W);
  assert.ok(facets.stages.includes("collecting"));
  assert.ok(facets.stages.includes("published"));
  assert.ok(facets.stages.includes("approved"));
  assert.ok(!facets.stages.includes("ranked"), "B's stage is not W's facet");
  assert.deepEqual(facets.seniorities, ["senior"]);
});

test("every ledger statement scopes each dev table it reads to the caller's workspace", () => {
  // The ledger is its own store slice (devcase-ledger.ts), so devcase-tenancy.test.ts's
  // scan of devcase.ts does not see it. This is the stricter guard for it: not "names
  // workspace_id somewhere" but "every dev table alias is filtered on its own tenant".
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "devcase-ledger.ts"), "utf8");
  const blocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
  const devBlocks = blocks.filter((s) => /\b(from|join)\s+dev_(cases|lifecycle|postings|submissions)\b/i.test(s));
  assert.ok(devBlocks.length >= 3, `the ledger, its stage facet and its seniority facet: found ${devBlocks.length}`);
  let checked = 0;
  for (const sql of devBlocks) {
    for (const [, table, alias] of sql.matchAll(/\b(?:from|join)\s+(dev_cases|dev_lifecycle|dev_postings)\s+([a-z]+)\b/gi)) {
      checked += 1;
      assert.match(sql, new RegExp(`\\b${alias}\\.workspace_id\\s*=\\s*\\?`), `${table} ${alias} is not tenant-filtered:\n${sql}`);
    }
  }
  assert.ok(checked >= 6, `expected every aliased dev table to be checked, checked ${checked}`);
  // dev_submissions is reached only through its posting, whose alias is filtered above.
  for (const sql of devBlocks.filter((s) => /\bdev_submissions\b/.test(s))) {
    assert.match(sql, /dev_submissions\s+s\s+ON\s+s\.posting_id\s*=\s*p\.id/i);
  }
});

test("NON-VACUITY: the alias guard rejects a ledger join that forgot one tenant", () => {
  const leaky = "SELECT c.id FROM dev_cases c LEFT JOIN dev_lifecycle l ON l.case_id = c.id WHERE c.workspace_id = ?";
  const unscoped = [...leaky.matchAll(/\b(?:from|join)\s+(dev_cases|dev_lifecycle|dev_postings)\s+([a-z]+)\b/gi)]
    .map(([, , alias]) => alias)
    .filter((alias) => !new RegExp(`\\b${alias}\\.workspace_id\\s*=\\s*\\?`).test(leaky));
  assert.deepEqual(unscoped, ["l"]);
});

// challenge-r03 devcase-workspace/B: the job page's "N assignments" chip lands on the
// ledger filtered to that role (?job=). The filter is part of the query, answered
// before the limit like the others, so the role's assignments are never "not on this
// page" while they exist.
test("a job filter keeps only that role's cases, before the limit", () => {
  const ws = createWorkspace("Ledger job team", "org-ledger-job").id;
  const mine = approveCase("Role one assignment", ws);
  for (let i = 0; i < 6; i += 1) approveCase(`Other role ${i}`, ws);
  ensureDb().prepare(`UPDATE dev_cases SET job_id = ?, created_at = ? WHERE id = ?`).run("j_ledger_1", "2020-01-01T00:00:00.000Z", mine);
  assert.ok(!listCaseLedger(3, ws).some((r) => r.id === mine), "unfiltered, the role's case sits past the page");
  assert.deepEqual(listCaseLedger(3, ws, { job: "j_ledger_1" }).map((r) => r.id), [mine]);
  assert.deepEqual(listCaseLedger(3, ws, { job: "j_nobody" }), []);
  assert.equal(listCaseLedger(50, ws, { job: "" }).length, 7, "a blank job filter narrows nothing");
});

// challenge-r09 devcase-lifecycle/B: the ledger's no-lifecycle fallback read 'published'
// whenever ANY posting existed - the `posted` CTE never looked at status - so a case
// whose intake was stopped still read live, and devcase-sla's stall rule (which counts
// 'published' as an open stage) kept chasing it. An OPEN posting reads 'published'; only
// closed postings read 'closed', the same word a closed lifecycle already uses.
test("no lifecycle: only closed postings read 'closed' (no stall), an open one still reads 'published'", () => {
  const ws = createWorkspace("Ledger intake team", "org-ledger-intake").id;
  const stopped = approveCase("Stopped by hand", ws);
  const p = createPosting({ caseId: stopped, channel: "local", token: `tok-stopped-${stopped}`, roleTitle: null, caseTitle: null });
  setPostingStatus(p.id, "closed");
  const reopened = approveCase("Reopened after a stop", ws);
  const old = createPosting({ caseId: reopened, channel: "local", token: `tok-old-${reopened}`, roleTitle: null, caseTitle: null });
  setPostingStatus(old.id, "closed");
  createPosting({ caseId: reopened, channel: "local", token: `tok-new-${reopened}`, roleTitle: null, caseTitle: null });

  const rows = listCaseLedger(50, ws);
  const stoppedRow = rows.find((r) => r.id === stopped);
  assert.equal(stoppedRow?.stage, "closed");
  assert.equal(rows.find((r) => r.id === reopened)?.stage, "published");
  assert.deepEqual(listCaseLedger(50, ws, { stage: "closed" }).map((r) => r.id), [stopped]);
  // The stall chip reads the ledger's stage: a closed case is not an empty OPEN one.
  const longAgo = Date.parse(stoppedRow!.createdAt) + 30 * 86_400_000;
  assert.equal(
    lifecycleStall({ stage: stoppedRow!.stage, createdAt: stoppedRow!.createdAt, submissionCount: 0 }, longAgo).stalled,
    false
  );
  const facets = listCaseLedgerFacets(ws);
  assert.ok(facets.stages.includes("closed"), "the stage picker offers 'closed'");
  assert.ok(facets.stages.includes("published"));
});
