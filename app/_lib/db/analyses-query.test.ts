// History asks the server (challenge-r09 cv-analyze-workspace/A).
//
// History used to fetch the NEWEST 200 analysis groups and then search and filter that
// slice on the client, so a workspace past 200 groups got confident wrong answers: the
// search missed older candidates, the family dropdown could not offer a family that
// only older rows carry, and 'undecided' under-counted. listAnalysesPage now takes the
// query - q, family, seniority, disposition - applies it AFTER the newest-per-(cv_hash,
// jd_slug) grouping and BEFORE the window, and pages by keyset on (created_at, slug);
// listAnalysisFacets answers the dropdown vocabulary for the whole workspace.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { ensureDb } from "./core.ts";
import * as store from "./analyses.ts";

after(() => cleanupUnitDb());

// The card's API, read loosely so each case fails on its own assertion (not on a
// missing export) before the build lands.
type Query = { q?: string; family?: string; seniority?: string; disposition?: string; cursor?: string | null; limit?: number };
type Page = { rows: store.AnalysisListRow[]; truncated: boolean; limit: number; nextCursor?: string | null };
type Facets = { families: string[]; seniorities: string[] };
const listAnalysesPage = store.listAnalysesPage as unknown as (query: Query, ws: string) => Page;
const listAnalysisFacets = (ws: string): Facets => {
  const fn = (store as unknown as { listAnalysisFacets?: (ws: string) => Facets }).listAnalysisFacets;
  assert.equal(typeof fn, "function", "listAnalysisFacets is exported");
  return fn!(ws);
};

const at = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 60_000).toISOString();
function save(ws: string, label: string, createdAt: string, extra: Partial<store.SaveAnalysisInput> = {}): string {
  const { slug } = store.saveAnalysis(
    { candidateLabel: label, jdSlug: "jd-a", score: 60, roleFamily: "engineering_backend", seniority: "senior", payload: { ok: true }, ...extra },
    ws
  );
  ensureDb().prepare(`UPDATE analyses SET created_at = ? WHERE slug = ?`).run(createdAt, slug);
  return slug;
}

// ---- a 250-group workspace whose only 'Čapek' and only 'data_ai' row is the OLDEST ----
const BIG = "ws-history-big";
const OTHER = "ws-history-other";
let capekSlug = "";
ensureDb().transaction(() => {
  capekSlug = save(BIG, "Karel Čapek.pdf", at(0), { cvHash: "big-0", roleFamily: "data_ai", seniority: "principal" });
  for (let i = 1; i < 250; i += 1) save(BIG, `Candidate ${i}.pdf`, at(i), { cvHash: `big-${i}` });
  // Workspace B carries a name and a family A has never seen.
  save(OTHER, "Božena Němcová.pdf", at(5), { cvHash: "other-1", roleFamily: "legal_only_in_b" });
})();

test("search sees the whole set: the oldest of 250 groups is found by a folded needle", () => {
  const page = listAnalysesPage({ q: "capek", limit: 200 }, BIG);
  assert.deepEqual(page.rows.map((r) => r.slug), [capekSlug]);
  assert.equal(page.truncated, false);
  assert.equal(page.nextCursor ?? null, null);
  // The folded needle matches whatever the recruiter typed.
  assert.deepEqual(listAnalysesPage({ q: "  ČAPEK ", limit: 200 }, BIG).rows.map((r) => r.slug), [capekSlug]);
  // Filters narrow BEFORE the window, not over it.
  assert.deepEqual(listAnalysesPage({ family: "data_ai", limit: 200 }, BIG).rows.map((r) => r.slug), [capekSlug]);
  assert.deepEqual(listAnalysesPage({ seniority: "principal", limit: 200 }, BIG).rows.map((r) => r.slug), [capekSlug]);
});

test("facets describe the workspace, not the page", () => {
  const facets = listAnalysisFacets(BIG);
  assert.ok(facets.families.includes("data_ai"), "a family only the 250th-newest group carries is offered");
  assert.ok(facets.seniorities.includes("principal"));
  assert.ok(!facets.families.includes("legal_only_in_b"), "never a family that exists only in another workspace");
  assert.deepEqual(facets.families, [...facets.families].sort(), "sorted, distinct");
});

test("tenancy: a q that only matches workspace B answers nothing for A", () => {
  assert.equal(listAnalysesPage({ q: "nemcova", limit: 200 }, BIG).rows.length, 0);
  assert.equal(listAnalysesPage({ q: "nemcova", limit: 200 }, OTHER).rows.length, 1, "non-vacuity: B finds its own row");
  assert.ok(!listAnalysisFacets(BIG).families.includes("legal_only_in_b"));
  assert.deepEqual(listAnalysisFacets(OTHER).families, ["legal_only_in_b"]);
});

test("grouping comes before the filter: a superseded 'pass' cannot resurface", () => {
  const ws = "ws-history-group";
  const older = save(ws, "Twice.pdf", at(1), { cvHash: "same-cv" });
  const newer = save(ws, "Twice.pdf", at(2), { cvHash: "same-cv" });
  ensureDb().prepare(`UPDATE analyses SET disposition = 'pass' WHERE slug = ?`).run(older);
  assert.equal(listAnalysesPage({ disposition: "pass" }, ws).rows.length, 0, "the older run's decision is not the group's");
  const undecided = listAnalysesPage({ disposition: "undecided" }, ws).rows;
  assert.deepEqual(undecided.map((r) => r.slug), [newer]);
  assert.equal(undecided[0].prior_runs, 1);
});

test("keyset paging is stable on ties: created_at, then slug", () => {
  const ws = "ws-history-ties";
  const same = at(42);
  const slugs = ["Tie A.pdf", "Tie B.pdf", "Tie C.pdf"].map((label, i) => save(ws, label, same, { cvHash: `tie-${i}` }));
  const first = listAnalysesPage({ limit: 2 }, ws);
  assert.equal(first.rows.length, 2);
  assert.equal(first.truncated, true);
  assert.equal(typeof first.nextCursor, "string", "a cut page names where the next one starts");
  // A row saved between the two page loads is newer than the cursor: it never
  // shifts the second page (an offset would have repeated a row).
  save(ws, "Tie late.pdf", at(99), { cvHash: "tie-late" });
  const second = listAnalysesPage({ limit: 2, cursor: first.nextCursor }, ws);
  assert.equal(second.rows.length, 1);
  assert.equal(second.truncated, false);
  assert.equal(second.nextCursor ?? null, null);
  const union = [...first.rows, ...second.rows].map((r) => r.slug);
  assert.equal(new Set(union).size, 3, "no duplicate across the pages");
  assert.deepEqual([...union].sort(), [...slugs].sort(), "the union is all three tied rows");
  assert.deepEqual(union, [...slugs].sort().reverse(), "the tie is broken by slug, descending");
});

test("a malformed cursor or unknown disposition falls back rather than throwing", () => {
  const ws = "ws-history-ties";
  assert.equal(listAnalysesPage({ limit: 10, cursor: "not-a-cursor" }, ws).rows.length, 4);
  assert.equal(listAnalysesPage({ limit: 10, disposition: "maybe" }, ws).rows.length, 4);
});

test("the numeric overload keeps every existing caller's contract", () => {
  const page = store.listAnalysesPage(100, BIG);
  assert.equal(page.rows.length, 100);
  assert.equal(page.truncated, true);
  assert.equal(page.limit, 100);
  assert.equal(store.listAnalyses(3, BIG).length, 3);
});
