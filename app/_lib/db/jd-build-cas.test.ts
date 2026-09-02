// Regression coverage for finishJdAnalysis's compare-and-swap half.
//
// A jd_build lands one to two minutes after it starts, and PATCH /api/jds/[slug]
// accepts an edit for that whole window. finishJdAnalysis used to be a bare
// `UPDATE jds SET body = ? WHERE slug = ?` with no precondition and — unlike
// updateJd/revertJd — no jd_revisions snapshot, so the edit was overwritten
// unrecoverably and the staleness signal (jdLastEditedAt) never saw it happen.
//
// Isolated throwaway DB — unit-db.ts must be the first project import (it sets
// KP_DB_PATH before any store opens a connection).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  finishJdAnalysis,
  insertAnalyzingJd,
  listJdRevisions,
  loadJd,
  markJdAnalyzing,
  updateJd,
} from "./jobs.ts";

after(() => cleanupUnitDb());

let seq = 0;
function placeholder() {
  seq += 1;
  const { slug } = insertAnalyzingJd({
    title: `CAS Role ${seq}`,
    options: { description: true, marketResearch: true, caseDesign: false },
  });
  return slug;
}

test("the untouched placeholder takes the build's body", () => {
  const slug = placeholder();
  const result = finishJdAnalysis(slug, { body: "# Built role\n\nGenerated.", analysisJson: { role: null } });
  assert.deepEqual(result, { ok: true, bodyWritten: true });
  const row = loadJd(slug);
  assert.equal(row?.body, "# Built role\n\nGenerated.");
  assert.equal(row?.analysis_status, "ready");
  // Nothing was overwritten, so nothing is filed as a revision — a first fill is
  // not an edit, and a spurious revision would move the staleness signal.
  assert.equal(listJdRevisions(slug).length, 0);
});

test("an edit made DURING the build survives it — the build result becomes a revision", () => {
  const slug = placeholder();
  // The operator fixes the placeholder while the 1–2 minute build is still running.
  assert.deepEqual(updateJd(slug, { title: "Hand-written role", body: "The wording we actually want." }), { ok: true });

  const result = finishJdAnalysis(slug, { body: "# Machine role\n\nGenerated.", analysisJson: { role: { title: "x" } } });
  assert.deepEqual(result, { ok: true, bodyWritten: false });

  const row = loadJd(slug);
  assert.equal(row?.body, "The wording we actually want.", "the operator's edit must still be the live body");
  assert.equal(row?.title, "Hand-written role");
  // …but the artifacts and the ready flip still land, or the row is stuck "Analyzing".
  assert.equal(row?.analysis_status, "ready");
  assert.match(String(row?.analysis_json), /Machine role|title/);

  // The build's output is recoverable, not lost: it is the newest revision, so the
  // Ledger's revision list offers it and revertJd can restore it.
  const revisions = listJdRevisions(slug);
  assert.equal(revisions[0]?.body, "# Machine role\n\nGenerated.");
});

test("a market-research-only build cannot be clobbered by a late duplicate run", () => {
  const slug = placeholder();
  // No description ⇒ the build composes no markdown, so a READY row legitimately
  // carries an empty body. `body = ''` alone would let a stale run overwrite its
  // artifacts; the analysis_status conjunct is what stops it.
  assert.deepEqual(finishJdAnalysis(slug, { body: "", analysisJson: { salarySource: "grounded" } }), {
    ok: true,
    bodyWritten: true,
  });
  const late = finishJdAnalysis(slug, { body: "# Late\n", analysisJson: { salarySource: "stale" } });
  assert.deepEqual(late, { ok: true, bodyWritten: false });
  const row = loadJd(slug);
  assert.equal(row?.body, "", "a finished row's body is not filled in by a later run");
  assert.match(String(row?.analysis_json), /stale/, "the artifacts of the run that actually finished last still land");
});

test("a retry after an operator edited the failed row keeps the edit", () => {
  const slug = placeholder();
  finishJdAnalysis(slug, { body: "", analysisJson: {} });
  assert.deepEqual(updateJd(slug, { title: "Edited", body: "Operator text." }), { ok: true });
  // retry-analysis resets the row to 'analyzing' and does NOT clear the body.
  markJdAnalyzing(slug);
  const result = finishJdAnalysis(slug, { body: "# Retry output\n", analysisJson: {} });
  assert.equal(result.ok && result.bodyWritten, false);
  assert.equal(loadJd(slug)?.body, "Operator text.");
});

test("a landing build for a slug that no longer exists is a no-op, not a throw", () => {
  const result = finishJdAnalysis("no-such-jd-slug", { body: "# x", analysisJson: {} });
  assert.deepEqual(result, { ok: false, reason: "not_found" });
});
