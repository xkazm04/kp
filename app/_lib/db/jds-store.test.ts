import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { saveJd, listJds, loadJd, updateJd, listJdRevisions, setJdArchived } from "./jobs.ts";

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
