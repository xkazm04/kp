import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { saveJd, listJds, loadJd, updateJd, revertJd, listJdRevisions, setJdArchived } from "./jobs.ts";

after(() => cleanupUnitDb());

// Behavioral tenant-isolation coverage for the Library JD tables (P1) — proves the
// scoping actually holds end to end, beyond the source-regex guard in
// jds-tenancy.test.ts. Two synthetic workspaces (ws-a / ws-b) must never see each
// other's drafts, edit history, or edits.

test("a JD is only listed and loadable in its own workspace", () => {
  const a = saveJd({ title: "Team A role", body: "body A" }, "ws-a");
  const b = saveJd({ title: "Team B role", body: "body B" }, "ws-b");

  const listA = listJds(100, "ws-a").map((j) => j.slug);
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
  assert.ok(!listJds(100, "ws-a").some((j) => j.slug === a.slug), "an archived JD leaves the list");
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
