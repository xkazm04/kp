// Real-DB coverage for four pipeline reads/writes that carried none (grep). Each is
// FILL-ONLY or tenant-scoped in a way that is invisible from the call site, which is
// exactly the kind of contract that erodes silently:
//
//   candidateOutcomes                 — the per-candidate placement rollup the rediscovery
//                                       and duplicate-detection surfaces read.
//   terminalPriorEntriesForCandidate  — the qualifying priors behind a rematch offer.
//   mergeReapplication                — the ADDITIVE backfill on a re-apply: it fills
//                                       blanks and must never overwrite a value already
//                                       there (a candidate re-applying with a stale email
//                                       must not clobber the good one on file).
//   setEntryGithubEvidence            — the drawer's on-demand deep dive, also fill-only,
//                                       so a concurrent double-run keeps the FIRST result
//                                       and records exactly one event.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH so every store opens a
// throwaway SQLite file unique to this process).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  actOnPipelineEntry,
  candidateOutcomes,
  createPipelineEntry,
  getPipelineEntry,
  listPipelineEvents,
  mergeReapplication,
  setEntryGithubEvidence,
  terminalPriorEntriesForCandidate,
} from "./pipeline.ts";
import { ensureDb } from "./core.ts";

after(() => cleanupUnitDb());

const OTHER_WS = "ws-stats-other";

test("candidateOutcomes groups a candidate's placements by id and never crosses tenants", () => {
  const cand = "stats-cand-1";
  createPipelineEntry({ candidateId: cand, candidateLabel: "Multi Role", jobId: "job-x", jobTitle: "Backend", stage: "Screened" });
  createPipelineEntry({ candidateId: cand, candidateLabel: "Multi Role", jobId: "job-y", jobTitle: "Platform", stage: "Interview" });
  // The SAME candidate id in ANOTHER team. A rollup that leaked this would show one
  // tenant a placement in a role they cannot see.
  createPipelineEntry({
    candidateId: cand,
    candidateLabel: "Multi Role",
    jobId: "job-z",
    jobTitle: "Elsewhere",
    stage: "Screened",
    workspaceId: OTHER_WS,
  });

  const mine = candidateOutcomes();
  const theirs = candidateOutcomes(OTHER_WS);

  const rows = mine.get(cand) ?? [];
  assert.equal(rows.length, 2, "both of THIS team's placements, and only those");
  assert.deepEqual(
    rows.map((r) => r.jobId).sort(),
    ["job-x", "job-y"],
    "the other tenant's placement must not appear in this team's rollup"
  );
  assert.deepEqual((theirs.get(cand) ?? []).map((r) => r.jobId), ["job-z"]);
  assert.equal(rows.find((r) => r.jobId === "job-y")!.stage, "Interview", "the stage travels with the placement");
});

test("terminalPriorEntriesForCandidate returns only closed-out priors in OTHER roles", () => {
  const cand = "stats-cand-2";
  const current = createPipelineEntry({ candidateId: cand, candidateLabel: "Silver Medalist", jobId: "job-now", jobTitle: "Backend", stage: "Screened" }).entry;
  const rejected = createPipelineEntry({ candidateId: cand, candidateLabel: "Silver Medalist", jobId: "job-past", jobTitle: "Backend", stage: "Interview" }).entry;
  const stillOpen = createPipelineEntry({ candidateId: cand, candidateLabel: "Silver Medalist", jobId: "job-other", jobTitle: "Data", stage: "Screened" }).entry;

  actOnPipelineEntry(rejected.id, "reject");

  const priors = terminalPriorEntriesForCandidate(cand, "job-now");
  const ids = priors.map((p) => p.id);

  assert.deepEqual(ids, [rejected.id], "only the TERMINAL entry, and not the one in the excluded role");
  assert.equal(ids.includes(current.id), false, "the role being matched for is excluded by id");
  assert.equal(ids.includes(stillOpen.id), false, "an ACTIVE application elsewhere is not a 'prior'");
  assert.equal(priors[0].jobId, "job-past");

  // A blank candidate id is a soft miss, not a throw — the rematch surface calls this
  // with whatever the entry carries, including nothing.
  assert.deepEqual(terminalPriorEntriesForCandidate("", "job-now"), []);
  assert.deepEqual(terminalPriorEntriesForCandidate("   ", "job-now"), []);
});

test("mergeReapplication fills blanks and never overwrites a value already on file", () => {
  const withContact = createPipelineEntry({
    candidateId: "stats-cand-3",
    candidateLabel: "Re Applicant",
    jobId: "job-merge",
    jobTitle: "Backend",
    stage: "Screened",
    contact: "good@example.test",
  }).entry;

  // The re-apply carries a DIFFERENT (stale) email and a github handle the entry lacks.
  const merged = mergeReapplication(withContact.id, { contact: "stale@example.test", githubHandle: "octocat" });

  assert.equal(merged?.contact, "good@example.test", "an existing contact is authoritative — the backfill is additive, not a write");
  assert.equal(merged?.githubHandle, "octocat", "a BLANK field is filled");

  // The empty-string case: '' is as blank as NULL, and the guard says so explicitly.
  const blank = createPipelineEntry({
    candidateId: "stats-cand-4",
    candidateLabel: "Blank Contact",
    jobId: "job-merge-2",
    jobTitle: "Backend",
    stage: "Screened",
    contact: "",
  }).entry;
  assert.equal(mergeReapplication(blank.id, { contact: "filled@example.test" })?.contact, "filled@example.test");

  // An unknown id is a soft miss, and a scoped call cannot reach another tenant's row.
  assert.equal(mergeReapplication("no-such-entry", { contact: "x@example.test" }), null);
  assert.equal(
    mergeReapplication(withContact.id, { githubHandle: "wrong-tenant" }, OTHER_WS),
    null,
    "the merge is workspace-scoped — another team's re-apply must not reach this row"
  );
});

test("setEntryGithubEvidence is fill-only: the first result wins and records ONE event", () => {
  const entry = createPipelineEntry({
    candidateId: "stats-cand-5",
    candidateLabel: "Evidence Person",
    jobId: "job-gh",
    jobTitle: "Backend",
    stage: "Screened",
  }).entry;

  // The COLUMN, not the parsed `githubEvidence` projection: the fill-only claim is about
  // what the store keeps, and coerceGithubEvidenceSummary would normalize the difference
  // between the two payloads away at the read boundary.
  const storedJson = (): string | null =>
    (ensureDb().prepare(`SELECT github_json FROM pipeline_entries WHERE id = ?`).get(entry.id) as { github_json: string | null })
      .github_json;

  const first = setEntryGithubEvidence(entry.id, JSON.stringify({ repos: 12 }));
  assert.ok(first, "the first attach succeeds");
  assert.match(storedJson() ?? "", /"repos":12/);
  assert.ok(getPipelineEntry(entry.id), "the entry still reads back through the normal projection");

  // A concurrent (or simply repeated) deep dive must not stomp the attached evidence.
  setEntryGithubEvidence(entry.id, JSON.stringify({ repos: 999 }));
  assert.match(
    storedJson() ?? "",
    /"repos":12/,
    "evidence already attached is never silently overwritten — a double-run keeps the first result"
  );

  const attached = listPipelineEvents(200).filter((e) => e.entryId === entry.id && e.kind === "github_evidence_attached");
  assert.equal(attached.length, 1, "the no-op second run must not record a second attach event");

  assert.equal(setEntryGithubEvidence("no-such-entry", "{}"), null, "an unknown id is a soft miss");
  assert.equal(
    setEntryGithubEvidence(entry.id, "{}", OTHER_WS),
    null,
    "the write is workspace-scoped — another team cannot attach evidence to this entry"
  );
});
