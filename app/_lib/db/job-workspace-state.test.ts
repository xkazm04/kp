// The per-team lifecycle overlay for SHARED corpus roles (job_workspace_state).
//
// A seeded corpus role (jobs.workspace_id NULL) is one row every team sees, but whether
// a team has closed it, how many hires it is open for and which languages it is posted
// in are facts about ONE team's hiring. Those live in the (workspace_id, job_id)
// overlay; the shared row keeps its own values as the BASE every team reads until it
// writes its own. Authored roles (workspace_id set) are one team's property and keep
// writing their own row exactly as before.
//
// BILLING IS NOT PER TEAM, deliberately. `published_at` stays on the shared row and
// classifyPublish keeps reading it, so the once-per-job-EVER debit is unchanged: the
// last test drives random interleavings of three teams against a model of the
// pre-overlay rule and asserts every step charges exactly what it charged before.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { ensureDb } from "./core.ts";
import {
  closeRoleIfOpen,
  countJobs,
  countOpenRoles,
  getJob,
  getRoleOpenConfig,
  listCorpusJobs,
  listJobsPage,
  setRoleOpenConfig,
} from "./jobs.ts";
import { classifyPublish, getJobStatus, insertJob, setJobStatus } from "../job-ingest.ts";
import { DEFAULT_WORKSPACE_ID } from "./workspaces.ts";

after(() => cleanupUnitDb());

const A = "ws-overlay-a";
const B = "ws-overlay-b";

/** A shared corpus row, inserted the way the seed leaves one: workspace_id NULL, and
 *  (unless a legacy state is being modelled) status and published_at NULL. */
function seedCorpus(id: string, status: string | null = null, publishedAt: string | null = null): void {
  ensureDb()
    .prepare(
      `INSERT INTO jobs (id, title, payload_json, status, workspace_id, published_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`
    )
    .run(id, id, JSON.stringify({ id, title: id }), status, publishedAt, new Date().toISOString());
}

const baseRow = (id: string) =>
  ensureDb().prepare(`SELECT status, published_at, target_hires, posting_langs FROM jobs WHERE id = ?`).get(id) as {
    status: string | null;
    published_at: string | null;
    target_hires: number | null;
    posting_langs: string | null;
  };

const overlayRows = (id: string) =>
  (ensureDb().prepare(`SELECT COUNT(*) AS n FROM job_workspace_state WHERE job_id = ?`).get(id) as { n: number }).n;

const inCorpus = (id: string, ws: string) => listCorpusJobs(ws).some((j) => j.id === id);

test("case 1: one team closing a corpus role closes it for that team only; the shared row is untouched", () => {
  seedCorpus("ov-close");
  assert.equal(closeRoleIfOpen("ov-close", A), true, "the first close by A retires the role for A");
  assert.equal(inCorpus("ov-close", B), true, "B still matches against the role");
  assert.equal(inCorpus("ov-close", A), false, "A's rematch corpus no longer carries it");
  assert.equal(baseRow("ov-close").status, null, "the shared row's own status is still NULL");
  // The public apply door resolves the DEFAULT team (getJobWorkspace folds a NULL owner
  // to it), so A's close does not shut it — only the default team's own close would.
  assert.equal(getJobStatus("ov-close", DEFAULT_WORKSPACE_ID), null, "the apply door still reads the role as live");
  assert.equal(closeRoleIfOpen("ov-close", DEFAULT_WORKSPACE_ID), true);
  assert.equal(getJobStatus("ov-close", DEFAULT_WORKSPACE_ID), "closed", "the default team's close is what shuts the public door");
  assert.equal(inCorpus("ov-close", B), true, "and B is still unaffected");
});

test("case 2: closeRoleIfOpen is a per-team compare-and-swap - true once, then false", () => {
  seedCorpus("ov-cas");
  assert.equal(closeRoleIfOpen("ov-cas", A), true);
  assert.equal(closeRoleIfOpen("ov-cas", A), false, "the second close by the same team is the loser");
  assert.equal(closeRoleIfOpen("ov-cas", B), true, "B's own close is its own swap");
  assert.equal(closeRoleIfOpen("ov-cas", B), false);
});

test("case 3: a team's publish writes its overlay AND stamps the shared published_at; billing reads the stamp", () => {
  seedCorpus("ov-pub");
  assert.deepEqual(classifyPublish("ov-pub", A), { already: false, wasClosed: false, billable: true }, "a never-published role is a first go-live");
  setJobStatus("ov-pub", "published", A);
  const row = baseRow("ov-pub");
  assert.equal(row.status, null, "no jobs.status write for a corpus row");
  assert.ok(row.published_at, "the shared first-go-live stamp is written exactly as before");
  assert.equal(classifyPublish("ov-pub", A).already, true, "A sees its own go-live");
  assert.deepEqual(
    classifyPublish("ov-pub", B),
    { already: false, wasClosed: false, billable: false },
    "B has not adopted it yet, and the role has been to market, so B's adoption is not metered"
  );
});

test("case 4: target hires and posting languages are per team", () => {
  seedCorpus("ov-cfg");
  setRoleOpenConfig("ov-cfg", { targetHires: 3, postingLangs: ["cs"] }, A);
  assert.deepEqual(getRoleOpenConfig("ov-cfg", B), { targetHires: 1, postingLangs: [] });
  assert.deepEqual(getRoleOpenConfig("ov-cfg", A), { targetHires: 3, postingLangs: ["cs"] });
  // COALESCE re-publish rule survives per team: restating nothing keeps the target.
  setRoleOpenConfig("ov-cfg", { targetHires: null, postingLangs: null }, A);
  assert.deepEqual(getRoleOpenConfig("ov-cfg", A), { targetHires: 3, postingLangs: ["cs"] });
  assert.equal(baseRow("ov-cfg").target_hires, null, "the shared row's target is untouched");
  assert.equal(getJob("ov-cfg", A)?.targetHires, 3, "the point read decorates with the team's target");
  assert.equal(getJob("ov-cfg", B)?.targetHires, 1);
});

test("case 5: counts and the browse page fold the overlay per team", () => {
  // Fresh teams: the cases above closed other corpus roles for A and B.
  const A = "ws-count-a";
  const B = "ws-count-b";
  seedCorpus("ov-count");
  const openB = countJobs({ openOnly: true }, B);
  const beforeA = countOpenRoles(A).corpus;
  assert.equal(beforeA, countOpenRoles(B).corpus, "precondition: both teams see the same live corpus");
  assert.equal(closeRoleIfOpen("ov-count", A), true);
  assert.equal(countOpenRoles(A).corpus, countOpenRoles(B).corpus - 1, "A carries one fewer open corpus role");
  assert.equal(countJobs({ openOnly: true }, B), openB, "B's open count is unchanged by A's close");
  assert.equal(countJobs({ openOnly: true }, A), openB - 1);
  const find = (ws: string) => listJobsPage({ q: "ov-count", limit: 500 }, ws).jobs.find((j) => j.id === "ov-count");
  assert.equal(find(B)?.status, null, "B's page decorates the role as live (NULL)");
  assert.equal(find(A)?.status, "closed", "A's page decorates it closed");
});

test("case 6: an authored role writes its own row and never an overlay row", () => {
  insertJob({ id: "ov-authored", title: "Authored" } as never, undefined, "published", A);
  setJobStatus("ov-authored", "closed", A);
  assert.equal(baseRow("ov-authored").status, "closed", "jobs.status is updated exactly as today");
  setRoleOpenConfig("ov-authored", { targetHires: 2 }, A);
  assert.equal(baseRow("ov-authored").target_hires, 2);
  assert.equal(closeRoleIfOpen("ov-authored", A), false, "already closed");
  assert.equal(overlayRows("ov-authored"), 0, "the overlay is only for workspace_id NULL rows");
});

test("case 7: a legacy corpus row closed before the overlay reads closed for every team", () => {
  seedCorpus("ov-legacy-closed", "closed");
  for (const ws of [A, B, DEFAULT_WORKSPACE_ID]) {
    assert.equal(inCorpus("ov-legacy-closed", ws), false, `${ws} reads the base 'closed'`);
    assert.equal(classifyPublish("ov-legacy-closed", ws).wasClosed, true);
  }
  assert.equal(getJobStatus("ov-legacy-closed", DEFAULT_WORKSPACE_ID), "closed");
  assert.equal(overlayRows("ov-legacy-closed"), 0, "the base value is kept, never guessed into one team's overlay");
});

test("case 8: a legacy corpus row published before the stamp existed stays on the shared row", () => {
  // status 'published' with published_at NULL: the billing rule reads it as "never been
  // to market" and its lifecycle has always been shared. Moving its close into one
  // team's overlay would change who pays for the next go-live, so it is left alone
  // until a close moves its base to 'closed' (after which case 7 applies).
  seedCorpus("ov-legacy-pub", "published", null);
  assert.equal(closeRoleIfOpen("ov-legacy-pub", A), true);
  assert.equal(baseRow("ov-legacy-pub").status, "closed", "the close lands on the shared row, as it always did");
  assert.equal(overlayRows("ov-legacy-pub"), 0);
  assert.deepEqual(classifyPublish("ov-legacy-pub", B), { already: false, wasClosed: true, billable: true });
});

test("billing parity: random three-team interleavings charge exactly what the pre-overlay rule charged", () => {
  // Deterministic PRNG so a failure reproduces.
  let seed = 0x5eed;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const teams = [DEFAULT_WORKSPACE_ID, A, B];
  const starts: Array<[string | null, string | null]> = [
    [null, null],
    ["closed", null],
    ["closed", "2026-01-01T00:00:00.000Z"],
    ["published", null],
    ["published", "2026-01-01T00:00:00.000Z"],
  ];
  let n = 0;
  for (let round = 0; round < 40; round++) {
    for (const [status, stamp] of starts) {
      const id = `ov-parity-${n++}`;
      seedCorpus(id, status, stamp);
      // The model: today's code on ONE shared row.
      const model = { status, stamp };
      for (let step = 0; step < 12; step++) {
        const team = teams[Math.floor(rand() * teams.length)];
        const action = rand();
        if (action < 0.45) {
          // The publish route's decision: skip when already live, bill when billable.
          const want = model.status === "published" ? null : !model.stamp;
          if (model.status !== "published") {
            model.status = "published";
            model.stamp = model.stamp ?? "stamped";
          }
          const tr = classifyPublish(id, team);
          const got = tr.already ? null : tr.billable;
          if (!tr.already) setJobStatus(id, "published", team);
          // A charge is `got === true`; the overlay may turn a model no-op (null) into
          // an unbilled adoption (false), which charges nothing either way.
          assert.equal(got === true, want === true, `step ${step} ${team} publish on ${id} (start ${status}/${stamp})`);
        } else if (action < 0.75) {
          // The manual close route.
          if (model.status !== "closed") model.status = "closed";
          if (getJobStatus(id, team) !== "closed") setJobStatus(id, "closed", team);
        } else {
          // The role-fill hook's compare-and-swap.
          if (model.status === null || model.status === "published") model.status = "closed";
          closeRoleIfOpen(id, team);
        }
      }
    }
  }
});
