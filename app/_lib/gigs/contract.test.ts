// The generated check-deliverable.mjs (contract.ts): it runs as plain Node in a gig folder and
// its verdict agrees with kp's own validator (deliverable.ts) - an object it passes, sync
// accepts; the shapes the 2026-09-27 training cycle's agents actually wrote, it fails.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GIG_DELIVERABLE_CHECKER_FILE, GIG_DELIVERABLE_FILE, gigDeliverableCheckerSource } from "./contract.ts";
import { validateGigDeliverable } from "./deliverable.ts";

const TMP = mkdtempSync(path.join(tmpdir(), "kp-checker-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

let n = 0;
/** Run the checker in a fresh gig folder holding `fileText` as kp-deliverable.json. */
function check(fileText: string | null, files: string[] = []): { ok: boolean; out: string } {
  const dir = path.join(TMP, `gig-${++n}`);
  mkdirSync(path.join(dir, "deliverable"), { recursive: true });
  for (const f of files) writeFileSync(path.join(dir, f), "x");
  writeFileSync(path.join(dir, GIG_DELIVERABLE_CHECKER_FILE), gigDeliverableCheckerSource());
  if (fileText !== null) writeFileSync(path.join(dir, GIG_DELIVERABLE_FILE), fileText);
  try {
    const out = execFileSync(process.execPath, [GIG_DELIVERABLE_CHECKER_FILE], { cwd: dir, encoding: "utf8" });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: String((e as { stdout?: unknown }).stdout ?? "") };
  }
}

const GOOD = {
  version: 1,
  summary: "Built the proof.",
  draftText: "Proposal text.",
  artifacts: [{ kind: "file", ref: "deliverable/app.html", title: "Working demo" }],
  evidence: [{ kind: "test", command: "node --test", result: "6 pass", passed: true }],
  disclosure: "Prepared with AI assistance, reviewed by me.",
  confidence: 0.7,
  questions: [],
};

test("a contract-shaped object passes the checker AND kp's validator", () => {
  const r = check(JSON.stringify(GOOD), ["deliverable/app.html"]);
  assert.ok(r.ok, r.out);
  assert.match(r.out, /^OK kp-deliverable\.json matches kp-deliverable\.v1 \(1 artifacts, 1 evidence, 0 questions\)/);
  assert.equal(validateGigDeliverable(GOOD).ok, true);
});

test("the shapes the training cycle's agents wrote fail, and kp's validator agrees", () => {
  // A designed persona's own "verdict" object (2026-09-27, booking app).
  const verdict = { version: "kp-deliverable.v1", gigId: "g", decision: "PURSUE", verdict: "SEND", draftText: "short", artifacts: [] };
  const r1 = check(JSON.stringify(verdict));
  assert.equal(r1.ok, false);
  assert.match(r1.out, /version must be the NUMBER 1/);
  assert.match(r1.out, /unknown key "decision"/);
  assert.match(r1.out, /disclosure must be a non-empty string/);
  assert.equal(validateGigDeliverable(verdict).ok, false);
  // Hand-written JSON with an unescaped quote inside a string (productivity e-book).
  const r2 = check('{"version": 1, "summary": "closes with a filled "Today\'s Plan" page"}');
  assert.equal(r2.ok, false);
  assert.match(r2.out, /is not valid JSON/);
  assert.match(r2.out, /JSON serializer/);
});

test("stricter than kp where it helps: a missing file artifact and a droppable row fail", () => {
  const missing = check(JSON.stringify(GOOD)); // deliverable/app.html not written
  assert.equal(missing.ok, false);
  assert.match(missing.out, /artifacts\[0\]\.ref "deliverable\/app\.html" does not exist/);
  const badRow = { ...GOOD, evidence: [{ kind: "vibes", result: "", passed: "yes" }] };
  const r = check(JSON.stringify(badRow), ["deliverable/app.html"]);
  assert.equal(r.ok, false);
  assert.match(r.out, /evidence\[0\]\.kind must be one of/);
  assert.match(r.out, /evidence\[0\]\.passed must be true, false or null/);
  assert.equal(validateGigDeliverable(badRow).ok, true, "kp would accept but silently drop the row - the checker makes the agent fix it");
});

test("no file at all says so", () => {
  const r = check(null);
  assert.equal(r.ok, false);
  assert.match(r.out, /kp-deliverable\.json is missing/);
});
