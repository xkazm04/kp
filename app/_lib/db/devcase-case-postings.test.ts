// The assignment detail's own postings read, and the lifecycle list's per-case counts
// (challenge-r09 devcase-lifecycle/A).
//
// The detail reader used to filter the workspace-wide postings fold client-side
// (postings.filter(p => p.caseId === kase.id)) and the lifecycle section folded the same
// fold down to two integers per case. Both now come from SQL scoped to one case (or the
// listed cases) AND the caller's workspace - never a client-side filter.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDb } from "./core.ts";
import { createWorkspace } from "./workspaces.ts";
import { createPosting, createSubmission, getPosting, saveDevCase, startDevSession } from "./devcase.ts";
import { caseIntakeCounts, listCasePostings } from "./devcase-case-postings.ts";

after(() => cleanupUnitDb());

const wsA = createWorkspace("Case postings A", "org-case-postings-a").id;
const wsB = createWorkspace("Case postings B", "org-case-postings-b").id;
const design = (title: string) => ({ need: { title }, analysis: null, role: { title: "Engineer" }, case: { title } });
const caseA = saveDevCase(design("Case A"), wsA).id;
const caseB = saveDevCase(design("Case B"), wsA).id;

const post = (caseId: string, channel: string) =>
  createPosting({ caseId, channel, token: `tok-${caseId}-${channel}`, roleTitle: "Engineer", caseTitle: null });

const a1 = post(caseA, "careers");
const a2 = post(caseA, "linkedin");
for (const ch of ["careers", "linkedin", "referral"]) post(caseB, ch);
// A corrupt cross-link: a posting pointing at case A but owned by workspace B. The read
// must drop it on the SQL tenant predicate, not on anything the client does.
const stray = post(caseA, "stray");
ensureDb().prepare(`UPDATE dev_postings SET workspace_id = ? WHERE id = ?`).run(wsB, stray.id);
ensureDb().prepare(`UPDATE dev_postings SET status = 'closed' WHERE id = ?`).run(a2.id);

test("listCasePostings(caseA, wsA) answers exactly case A's own postings, each with its status", () => {
  const rows = listCasePostings(caseA, wsA);
  assert.deepEqual(rows.map((p) => p.id).sort(), [a1.id, a2.id].sort());
  const byId = new Map(rows.map((p) => [p.id, p]));
  assert.equal(byId.get(a1.id)?.status, "open");
  assert.equal(byId.get(a2.id)?.status, "closed");
  assert.ok(rows.every((p) => p.caseId === caseA && p.workspaceId === wsA));
});

test("the stray posting is reachable in wsB only, and case B is never mixed in", () => {
  assert.deepEqual(listCasePostings(caseA, wsB).map((p) => p.id), [stray.id]);
  assert.equal(listCasePostings(caseB, wsA).length, 3);
  assert.deepEqual(listCasePostings(caseB, wsB), []);
});

test("a row is the same Posting the by-id read maps, plus its submission count", () => {
  createSubmission({ postingId: a1.id, candidateRef: "Ada", repoRef: "repo-ada" });
  const row = listCasePostings(caseA, wsA).find((p) => p.id === a1.id);
  assert.ok(row);
  assert.deepEqual(row, { ...getPosting(a1.id), submissionCount: 1 });
});

test("caseIntakeCounts: submissions summed across a case's postings, in-flight folded per case", () => {
  const ws = createWorkspace("Case counts", "org-case-counts").id;
  const busy = saveDevCase(design("Busy"), ws).id;
  const quiet = saveDevCase(design("Quiet"), ws).id;
  const p1 = createPosting({ caseId: busy, channel: "careers", token: "tok-busy-1", roleTitle: null, caseTitle: null });
  const p2 = createPosting({ caseId: busy, channel: "linkedin", token: "tok-busy-2", roleTitle: null, caseTitle: null });
  createSubmission({ postingId: p1.id, candidateRef: "c1", repoRef: "r1" });
  createSubmission({ postingId: p2.id, candidateRef: "c2", repoRef: "r2" });
  createSubmission({ postingId: p2.id, candidateRef: "c3", repoRef: "r3" });
  const live = startDevSession({ token: "tok-busy-2", candidateRef: "live-ref" });

  const counts = caseIntakeCounts([busy, quiet], ws);
  assert.equal(counts.get(busy)?.submissionCount, 3);
  assert.deepEqual(counts.get(busy)?.inFlight, { live: 1, idle: 0, oldestLiveStartedAt: live.createdAt });
  assert.deepEqual(counts.get(quiet), { submissionCount: 0, inFlight: { live: 0, idle: 0, oldestLiveStartedAt: null } });
  // Another workspace asking for the same ids sees nothing of them.
  assert.equal(caseIntakeCounts([busy], wsB).get(busy)?.submissionCount, 0);
  assert.deepEqual(caseIntakeCounts([], ws).size, 0);
});

test("every statement in the slice filters each dev table alias on its own workspace", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "devcase-case-postings.ts"), "utf8");
  const blocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]).filter((s) => /\b(from|join)\s+dev_/i.test(s));
  assert.ok(blocks.length >= 2, `found ${blocks.length} dev statements`);
  let checked = 0;
  for (const sql of blocks) {
    for (const [, table, alias] of sql.matchAll(/\b(?:from|join)\s+(dev_postings|dev_submissions|dev_sessions)\s+([a-z]+)\b/gi)) {
      checked += 1;
      assert.match(sql, new RegExp(`\\b${alias}\\.workspace_id\\s*=\\s*\\?`), `${table} ${alias} is not tenant-filtered:\n${sql}`);
    }
  }
  assert.ok(checked >= 3, `expected every aliased dev table to be checked, checked ${checked}`);
});
