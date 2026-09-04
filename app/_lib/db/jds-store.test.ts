import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  saveJd,
  listJdsPage,
  jdLibraryStats,
  loadJd,
  updateJd,
  revertJd,
  listJdRevisions,
  setJdArchived,
  JDS_PAGE_DEFAULT_LIMIT,
  JDS_PAGE_MAX_LIMIT,
  JD_REVISIONS_MAX,
} from "./jobs.ts";

after(() => cleanupUnitDb());

// Behavioral tenant-isolation coverage for the Library JD tables (P1) — proves the
// scoping actually holds end to end, beyond the source-regex guard in
// jds-tenancy.test.ts. Two synthetic workspaces (ws-a / ws-b) must never see each
// other's drafts, edit history, or edits.

test("a JD is only listed and loadable in its own workspace", () => {
  const a = saveJd({ title: "Team A role", body: "body A" }, "ws-a");
  const b = saveJd({ title: "Team B role", body: "body B" }, "ws-b");

  const listA = listJdsPage(100, "ws-a").jds.map((j) => j.slug);
  assert.ok(listA.includes(a.slug), "team A sees its own JD");
  assert.ok(!listA.includes(b.slug), "team A must NOT see team B's JD");

  assert.ok(loadJd(a.slug, "ws-a"), "team A can load its own JD");
  assert.equal(loadJd(a.slug, "ws-b"), null, "team B cannot load team A's JD by slug");
});

test("edit, revert-history, and archive are all workspace-scoped", () => {
  const a = saveJd({ title: "Editable", body: "v1" }, "ws-a");

  // A cross-tenant edit is refused as not-found — never clobbers another team's JD.
  assert.deepEqual(updateJd(a.slug, { title: "hacked", body: "v2" }, undefined, "ws-b"), { ok: false, reason: "not_found" });

  // The owning tenant edits fine and a pre-edit revision is snapshotted under its workspace.
  assert.deepEqual(updateJd(a.slug, { title: "Editable", body: "v2" }, undefined, "ws-a"), { ok: true });
  assert.equal(listJdRevisions(a.slug, 30, "ws-a").length, 1);
  assert.equal(listJdRevisions(a.slug, 30, "ws-b").length, 0, "edit history is team-private");

  // Archive is scoped too: a cross-tenant archive is a no-op; the owner's archive works.
  assert.equal(setJdArchived(a.slug, true, "ws-b"), false, "cross-tenant archive must not match");
  assert.equal(setJdArchived(a.slug, true, "ws-a"), true);
  assert.ok(!listJdsPage(100, "ws-a").jds.some((j) => j.slug === a.slug), "an archived JD leaves the list");
});

// The content-CAS still refuses a stale base — the behavior `.immediate()` must not
// have changed. This is the contract the editor's 409 recovery is written against.
test("a stale baseBody is refused as a conflict, a fresh one is accepted", () => {
  const jd = saveJd({ title: "CAS role", body: "v1" }, "ws-cas");

  assert.deepEqual(updateJd(jd.slug, { title: "CAS role", body: "v2" }, "v1", "ws-cas"), { ok: true });
  // Second writer still holding "v1": refused, not applied on top of v2.
  assert.deepEqual(updateJd(jd.slug, { title: "CAS role", body: "v3" }, "v1", "ws-cas"), { ok: false, reason: "conflict" });
  assert.equal(loadJd(jd.slug, "ws-cas")?.body, "v2", "the losing write must not have landed");

  const revId = listJdRevisions(jd.slug, 30, "ws-cas")[0]!.id;
  assert.deepEqual(revertJd(jd.slug, revId, "stale", "ws-cas"), { ok: false, reason: "conflict" });
  assert.equal(revertJd(jd.slug, revId, "v2", "ws-cas").ok, true, "a revert on a fresh base still lands");
});

// The read→compare→write above is only atomic if the write lock is held from the
// SELECT. A DEFERRED transaction (a bare `tx()`) takes a shared read lock and upgrades
// at the first write, so a second connection can pass the same CAS check in the gap —
// last-write-wins, the exact failure the CAS exists to prevent. Asserted at the source
// because a single-process node:test cannot produce the second connection.
// (.claude/CLAUDE.md § "A read→compute→write either locks or re-checks".)
test("the JD write paths run their CAS under an IMMEDIATE transaction", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "jobs.ts"), "utf8");
  for (const fn of ["updateJd", "revertJd"]) {
    const at = src.indexOf(`export function ${fn}(`);
    assert.ok(at > 0, `${fn} moved — re-point this assertion`);
    const body = src.slice(at, src.indexOf("\nexport ", at + 1));
    assert.ok(body.includes("tx.immediate()"), `${fn} must take the write lock at BEGIN, not at its first write`);
  }
});

// ---- The library tells the truth about its own size (wave 40) ---------------

// listJds used to answer a bare array cut at a silent LIMIT, while listJobsPage
// beside it answered {truncated, limit}. A caller could not tell "these are all
// your JDs" from "these are the first N of more", and two of the three callers
// rendered `.length` as a total. The page shape is the same contract JobsPage
// holds, so the two library reads can no longer drift.
test("listJdsPage answers an honest truncation flag and the limit it cut at", () => {
  const ws = "ws-page";
  for (let i = 0; i < 5; i += 1) saveJd({ title: `Page role ${i}`, body: `body ${i}` }, ws);

  const full = listJdsPage(10, ws);
  assert.equal(full.jds.length, 5);
  assert.equal(full.truncated, false, "a page that held the whole library is not truncated");
  assert.equal(full.limit, 10, "the page states the bound it was cut at");

  const cut = listJdsPage(3, ws);
  assert.equal(cut.jds.length, 3, "the page never returns more than its limit");
  assert.equal(cut.truncated, true, "a cut slice says so");
  assert.equal(cut.limit, 3);
});

test("listJdsPage clamps a hostile or absent limit instead of binding it", () => {
  const ws = "ws-clamp";
  saveJd({ title: "Clamped", body: "b" }, ws);
  // SQLite reads LIMIT -1 as unbounded, so a negative must never reach the bind.
  for (const bad of [0, -1, Number.NaN, 1.5, undefined]) {
    assert.equal(listJdsPage(bad as number | undefined, ws).limit, JDS_PAGE_DEFAULT_LIMIT, `limit ${String(bad)} must fall back to the default`);
  }
  assert.equal(listJdsPage(10_000, ws).limit, JDS_PAGE_MAX_LIMIT, "an over-large limit is capped, not honoured");
});

test("jdLibraryStats counts the whole library, not the page in front of it", () => {
  const ws = "ws-stats";
  for (let i = 0; i < 4; i += 1) saveJd({ title: `Stat role ${i}`, body: `b${i}` }, ws);
  const stats = jdLibraryStats(ws);
  assert.equal(stats.total, 4, "the count is unbounded — it is not a page's .length");
  assert.equal(stats.analyzing, 0);
  assert.equal(stats.failed, 0);
  assert.equal(stats.newest?.title, "Stat role 3", "newest-first, like the page's ORDER BY");
  // …and the page beside it is still bounded, which is the whole reason a count exists.
  assert.equal(listJdsPage(2, ws).jds.length, 2);
});

// Every edit, revert and finished analysis INSERTs a full body copy into
// jd_revisions. listJdRevisions capped the READ at 100 but nothing capped the
// TABLE, so a JD edited in a loop grew the row store without bound for the life
// of the install. The cap keeps the newest JD_REVISIONS_MAX per slug.
test("the revision history is capped per slug, keeping the newest", () => {
  const ws = "ws-cap";
  const jd = saveJd({ title: "Churned", body: "v0" }, ws);
  const edits = JD_REVISIONS_MAX + 12;
  for (let i = 1; i <= edits; i += 1) {
    assert.deepEqual(updateJd(jd.slug, { title: "Churned", body: `v${i}` }, undefined, ws), { ok: true });
  }
  const kept = listJdRevisions(jd.slug, 100, ws);
  assert.equal(kept.length, JD_REVISIONS_MAX, `the table is capped at ${JD_REVISIONS_MAX} per slug`);
  // Newest-first: the most recent snapshot is the body the last edit replaced.
  assert.equal(kept[0]!.body, `v${edits - 1}`, "the newest snapshot survives");
  assert.ok(!kept.some((r) => r.body === "v0"), "the oldest snapshots were pruned");
  // The cap is PER SLUG — another JD's history is untouched by a churned neighbour.
  const other = saveJd({ title: "Calm", body: "c0" }, ws);
  assert.deepEqual(updateJd(other.slug, { title: "Calm", body: "c1" }, undefined, ws), { ok: true });
  assert.equal(listJdRevisions(other.slug, 100, ws).length, 1);
});

test("a revert never prunes the revision it is restoring from", () => {
  const ws = "ws-cap-revert";
  const jd = saveJd({ title: "Restorable", body: "v0" }, ws);
  assert.deepEqual(updateJd(jd.slug, { title: "Restorable", body: "v1" }, undefined, ws), { ok: true });
  // The oldest surviving snapshot — the one a revert would target — must still be
  // there after the revert's own snapshot pushes the history over the cap.
  const target = listJdRevisions(jd.slug, 100, ws).at(-1)!;
  for (let i = 2; i <= JD_REVISIONS_MAX + 4; i += 1) {
    assert.deepEqual(updateJd(jd.slug, { title: "Restorable", body: `v${i}` }, undefined, ws), { ok: true });
  }
  // `target` is long past the cap by now, so re-take the oldest kept one and revert to it.
  const oldest = listJdRevisions(jd.slug, 100, ws).at(-1)!;
  const restored = revertJd(jd.slug, oldest.id, undefined, ws);
  assert.equal(restored.ok, true);
  assert.ok(
    listJdRevisions(jd.slug, 100, ws).some((r) => r.id === oldest.id),
    "the revision the revert was based on must survive its own prune"
  );
  assert.equal(target.id > 0, true);
});
