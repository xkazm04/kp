// The Roles desk's three query axes — sort, the derived role status, and the 20-row
// window — answered by the STORE over every matching row (challenge-r07
// jobs-table-core/A). Before this, the page was cut at LIMIT 300 in entry-eligible
// order and the client sorted, status-filtered and windowed that slice, so a role
// ranked past the cut was unreachable from the table whatever the reader did.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB).
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { ensureDb, type JobRecord } from "./core.ts";
import { closeRoleIfOpen, countJobs, JOB_BROWSE_SORTS, JOB_ROLE_STATUSES, listJobs, listJobsPage, type JobFilter } from "./jobs.ts";
import { ROLE_STATUSES } from "../status-tone.ts";
import { JOB_SORT_ACCESSORS } from "../../features/library/jobs/jobsTableView.ts";
import { listJobPipelineStats } from "./pipeline.ts";
import { insertJob } from "../job-ingest.ts";
import { setDecisionConfig } from "../decision-config-store.ts";
import { roleStatusOf } from "../../features/library/jobs/jobsRoleStatus.ts";

after(() => cleanupUnitDb());

let entrySeq = 0;
/** A pipeline row standing on `stage` for `jobId` in `ws` — the fact `hired` counts. */
function entry(jobId: string, stage: string, ws: string): void {
  entrySeq += 1;
  ensureDb()
    .prepare(`INSERT INTO pipeline_entries (id, candidate_label, job_id, stage, workspace_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(`browse-e${entrySeq}`, `Cand ${entrySeq}`, jobId, stage, ws, new Date().toISOString());
}

function role(id: string, title: string, ws: string, family: string, extra: Partial<JobRecord> & { status?: string | null } = {}): void {
  const { status = "published", ...rest } = extra;
  insertJob({ id, title, roleFamily: family, ...rest } as unknown as JobRecord, undefined, status as string, ws);
}

function setTarget(id: string, target: number | null): void {
  ensureDb().prepare(`UPDATE jobs SET target_hires = ? WHERE id = ?`).run(target, id);
}

// ---- the 320-role workspace (cases 1, 2) --------------------------------------
const WS = "ws-browse-big";
const FAM = "fx-browse";
before(() => {
  const tx = ensureDb().transaction(() => {
    // 319 entry-eligible roles that outrank everything under the default ORDER BY…
    for (let i = 0; i < 319; i++) {
      const n = String(i).padStart(3, "0");
      role(`fx-b-${n}`, `Role ${n}`, WS, FAM, {
        entryProfile: { isEntryEligible: true, graduateFriendliness: 0.5 } as JobRecord["entryProfile"],
      });
    }
    // …and the alphabetically-first title, NOT entry-eligible, so it ranks last.
    role("fx-b-zzz-aaa", "Aaa Analyst", WS, FAM);
  });
  tx();
});

const BIG: JobFilter = { roleFamily: FAM };

test("case 1: sort=title reaches the alphabetically-first role the entry-ranked cut used to hide", () => {
  const defaultPage = listJobs(BIG, WS);
  assert.ok(!defaultPage.some((j) => j.id === "fx-b-zzz-aaa"), "precondition: the entry-ranked 300-row cut does not carry it");

  const page = listJobsPage({ ...BIG, sort: "title", dir: "asc", offset: 0, limit: 20 }, WS);
  assert.equal(page.jobs.length, 20);
  assert.equal(page.jobs[0]!.title, "Aaa Analyst", "row 1 of the whole matching set, not of a slice");
  assert.equal(page.truncated, true, "more rows sit past this window");
  assert.equal(countJobs({ ...BIG, sort: "title", dir: "asc", offset: 0, limit: 20 }, WS), 320);
});

test("case 2: roleStatus='filled' finds a filled role ranked past the 300-row cut, and the count agrees", () => {
  // The same non-eligible role, now filled: target 1, one hire on the terminal stage.
  entry("fx-b-zzz-aaa", "Hired", WS);
  const page = listJobsPage({ ...BIG, roleStatus: "filled" }, WS);
  assert.deepEqual(
    page.jobs.map((j) => j.id),
    ["fx-b-zzz-aaa"]
  );
  assert.equal(countJobs({ ...BIG, roleStatus: "filled" }, WS), 1);
  assert.equal(countJobs({ ...BIG, roleStatus: "open" }, WS), 319, "the open count is the rest, not the rest of a slice");
});

// ---- case 3: the SQL predicate against roleStatusOf, cell by cell ---------------
test("case 3: the SQL roleStatus agrees with roleStatusOf on the whole matrix, incl. a per-team overlay", () => {
  const ws = "ws-browse-matrix";
  const fam = "fx-matrix";
  const expected = new Map<string, string>();
  for (const status of [null, "published", "draft", "closed"] as const) {
    for (const hired of [0, 1, 3]) {
      for (const target of [null, 1, 3]) {
        const id = `fx-m-${status ?? "null"}-${hired}-${target ?? "null"}`;
        role(id, id, ws, fam, { status });
        setTarget(id, target);
        for (let h = 0; h < hired; h++) entry(id, "Hired", ws);
        expected.set(id, roleStatusOf({ status, targetHires: target ?? undefined, hired }));
      }
    }
  }
  // A SHARED corpus row whose lifecycle lives in each team's overlay.
  ensureDb()
    .prepare(`INSERT INTO jobs (id, title, role_family, payload_json, status, workspace_id, created_at) VALUES (?, ?, ?, ?, NULL, NULL, ?)`)
    .run("fx-m-corpus", "fx-m-corpus", fam, JSON.stringify({ id: "fx-m-corpus", title: "fx-m-corpus" }), new Date().toISOString());
  assert.equal(closeRoleIfOpen("fx-m-corpus", "ws-browse-team-b"), true);

  for (const rs of ["open", "draft", "filled", "closed"] as const) {
    const want = [...expected].filter(([, s]) => s === rs).map(([id]) => id);
    const got = listJobsPage({ roleFamily: fam, roleStatus: rs }, ws)
      .jobs.map((j) => j.id)
      .filter((id) => id !== "fx-m-corpus");
    assert.deepEqual(got.sort(), want.sort(), `roleStatus=${rs}`);
    assert.equal(countJobs({ roleFamily: fam, roleStatus: rs }, ws), want.length + (rs === "open" ? 1 : 0), `count for ${rs}`);
  }
  const ids = (team: string, rs: "open" | "closed") => listJobsPage({ roleFamily: fam, roleStatus: rs }, team).jobs.map((j) => j.id);
  assert.ok(ids("ws-browse-team-a", "open").includes("fx-m-corpus"), "team A still reads the corpus role as open");
  assert.ok(!ids("ws-browse-team-a", "closed").includes("fx-m-corpus"));
  assert.ok(ids("ws-browse-team-b", "closed").includes("fx-m-corpus"), "team B's overlay closed it for B only");
  assert.ok(!ids("ws-browse-team-b", "open").includes("fx-m-corpus"));
});

// ---- case 4: hired is read by terminal ROLE ------------------------------------
test("case 4: the window's per-row hired equals listJobPipelineStats on a renamed terminal stage", () => {
  const ws = "ws-browse-renamed";
  setDecisionConfig(
    "pipelineStages",
    {
      stages: [
        { id: "Inbox", label: "Inbox", role: "entry" },
        { id: "Signed", label: "Signed", role: "terminal" },
      ],
      retired: [],
    },
    ws
  );
  role("fx-r-1", "Renamed Role", ws, "fx-renamed");
  entry("fx-r-1", "Signed", ws);
  entry("fx-r-1", "Signed", ws);
  entry("fx-r-1", "Hired", ws); // the SHIPPED name, off this board's axis: not a hire here
  entry("fx-r-1", "Inbox", ws);
  const row = listJobsPage({ roleFamily: "fx-renamed", withHired: true }, ws).jobs.find((j) => j.id === "fx-r-1");
  assert.equal(listJobPipelineStats(ws)["fx-r-1"]!.hired, 2, "precondition: the rollup counts the renamed column");
  assert.equal(row?.hired, 2);
  setTarget("fx-r-1", 2);
  assert.deepEqual(
    listJobsPage({ roleFamily: "fx-renamed", roleStatus: "filled" }, ws).jobs.map((j) => j.id),
    ["fx-r-1"],
    "the status predicate reads the same terminal role"
  );
});

// ---- case 5: missing last, accent-folded title, status rank --------------------
test("case 5: NULL salary sorts last both ways; titles fold accents and case; status sorts by the desk's rank", () => {
  const ws = "ws-browse-order";
  const fam = "fx-order";
  role("fx-o-1", "Vývojář", ws, fam, { salaryBand: [50000, 70000] });
  role("fx-o-2", "účetní", ws, fam, { salaryBand: [30000, 40000] });
  role("fx-o-3", "Tester", ws, fam);
  role("fx-o-4", "Účetní", ws, fam, { salaryBand: [40000, 45000] });
  role("fx-o-5", "Ucetni", ws, fam, { salaryBand: [60000, 90000] });
  const order = (f: JobFilter) => listJobsPage({ roleFamily: fam, ...f }, ws).jobs.map((j) => j.id);

  assert.deepEqual(order({ sort: "salary", dir: "asc" }), ["fx-o-2", "fx-o-4", "fx-o-1", "fx-o-5", "fx-o-3"]);
  assert.deepEqual(order({ sort: "salary", dir: "desc" }), ["fx-o-5", "fx-o-1", "fx-o-4", "fx-o-2", "fx-o-3"], "NULL is last in desc too");
  // The three spellings of one word are adjacent, ties broken by id.
  assert.deepEqual(order({ sort: "title", dir: "asc" }), ["fx-o-3", "fx-o-2", "fx-o-4", "fx-o-5", "fx-o-1"]);

  // Status: open → draft → filled → closed, by the same CASE the filter uses.
  role("fx-s-closed", "S closed", ws, "fx-status", { status: "closed" });
  role("fx-s-draft", "S draft", ws, "fx-status", { status: "draft" });
  role("fx-s-filled", "S filled", ws, "fx-status");
  entry("fx-s-filled", "Hired", ws);
  role("fx-s-open", "S open", ws, "fx-status");
  const byStatus = (dir: "asc" | "desc") => listJobsPage({ roleFamily: "fx-status", sort: "status", dir }, ws).jobs.map((j) => j.id);
  assert.deepEqual(byStatus("asc"), ["fx-s-open", "fx-s-draft", "fx-s-filled", "fx-s-closed"]);
  assert.deepEqual(byStatus("desc"), ["fx-s-closed", "fx-s-filled", "fx-s-draft", "fx-s-open"]);
});

// ---- case 7: the default contract (a GUARD — green before by design) ------------
test("case 7: a call with no sort/offset/roleStatus keeps today's entry-eligible order, byte for byte", () => {
  const rows = listJobs(BIG, WS);
  assert.equal(rows.length, 300);
  const legacy = ensureDb()
    .prepare(
      `SELECT jobs.id FROM jobs LEFT JOIN job_workspace_state s ON s.workspace_id = ? AND s.job_id = jobs.id
       WHERE (jobs.workspace_id IS NULL OR jobs.workspace_id = ?) AND role_family = ?
       ORDER BY is_entry_eligible DESC, graduate_friendliness DESC, jobs.id LIMIT 300`
    )
    .all(WS, WS, FAM) as { id: string }[];
  assert.deepEqual(
    rows.map((j) => j.id),
    legacy.map((r) => r.id)
  );
  assert.ok(rows.every((j) => !("hired" in j)), "a default read is not decorated with fields it never carried");
});

test("the server's sort allowlist is exactly the table's sortable columns", () => {
  assert.deepEqual([...JOB_BROWSE_SORTS].sort(), Object.keys(JOB_SORT_ACCESSORS).sort());
  assert.deepEqual([...JOB_ROLE_STATUSES].sort(), [...ROLE_STATUSES].sort(), "the route's status allowlist is the vocabulary");
});

test("offset windows past the cut; an offset past the end is an empty page, not an error", () => {
  const second = listJobsPage({ ...BIG, sort: "title", dir: "asc", offset: 20, limit: 20 }, WS);
  const first = listJobsPage({ ...BIG, sort: "title", dir: "asc", offset: 0, limit: 20 }, WS);
  assert.equal(second.jobs.length, 20);
  assert.ok(!second.jobs.some((j) => first.jobs.some((f) => f.id === j.id)), "pages are disjoint");
  const last = listJobsPage({ ...BIG, sort: "title", dir: "asc", offset: 300, limit: 20 }, WS);
  assert.equal(last.jobs.length, 20);
  assert.equal(last.truncated, false, "the final window says nothing is left");
  assert.deepEqual(listJobsPage({ ...BIG, sort: "title", offset: 400, limit: 20 }, WS).jobs, []);
});
