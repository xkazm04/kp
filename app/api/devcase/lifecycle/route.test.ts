// GET /api/devcase/lifecycle carries each row's intake counts (challenge-r09
// devcase-lifecycle/A).
//
// The lifecycle section needs two numbers per row - submissions (the stall check's
// "empty?") and attempts mid-case (what the close confirm names) - and used to borrow the
// workspace's whole postings fold to derive them. They now ride the row: summed across
// every posting of the row's case, zeros (never an absent key) when there is no case.
//
// testing/unit-db.ts MUST be the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb } from "@/app/_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { ensureDb } from "@/app/_lib/db/core.ts";
import { createLifecycle, createPosting, createSubmission, saveDevCase, startDevSession } from "@/app/_lib/db/devcase.ts";
import { DEFAULT_WORKSPACE_ID } from "@/app/_lib/db/workspaces.ts";
import { GET } from "./route.ts";

after(() => cleanupUnitDb());

type Row = { id: string; caseId: string | null; submissionCount?: number; inFlight?: { live: number; idle: number; oldestLiveStartedAt: string | null } };

test("a row whose case has two postings (1 + 2 submissions, one live attempt) carries 3 and live 1; a caseless row carries zeros", async () => {
  const ws = DEFAULT_WORKSPACE_ID;
  const caseId = saveDevCase({ need: { title: "Counts" }, analysis: null, role: { title: "Engineer" }, case: { title: "Counts" } }, ws).id;
  const withCase = createLifecycle({ title: "With case" }, true, "en", ws);
  ensureDb().prepare(`UPDATE dev_lifecycle SET case_id = ?, stage = 'collecting' WHERE id = ?`).run(caseId, withCase.id);
  const caseless = createLifecycle({ title: "No case yet" }, true, "en", ws);

  const p1 = createPosting({ caseId, channel: "careers", token: "tok-lc-counts-1", roleTitle: null, caseTitle: null });
  const p2 = createPosting({ caseId, channel: "linkedin", token: "tok-lc-counts-2", roleTitle: null, caseTitle: null });
  createSubmission({ postingId: p1.id, candidateRef: "a", repoRef: "ra" });
  createSubmission({ postingId: p2.id, candidateRef: "b", repoRef: "rb" });
  createSubmission({ postingId: p2.id, candidateRef: "c", repoRef: "rc" });
  const live = startDevSession({ token: "tok-lc-counts-1", candidateRef: "mid-case" });

  const res = await GET();
  assert.equal(res.status, 200);
  const rows = ((await res.json()) as { lifecycles: Row[] }).lifecycles;
  const a = rows.find((r) => r.id === withCase.id);
  const b = rows.find((r) => r.id === caseless.id);
  assert.ok(a && b);
  assert.equal(a.submissionCount, 3);
  assert.equal(a.inFlight?.live, 1);
  assert.deepEqual(a.inFlight, { live: 1, idle: 0, oldestLiveStartedAt: live.createdAt });
  assert.ok("submissionCount" in b && "inFlight" in b, "a caseless row carries the keys, not an absence");
  assert.equal(b.submissionCount, 0);
  assert.deepEqual(b.inFlight, { live: 0, idle: 0, oldestLiveStartedAt: null });
});
