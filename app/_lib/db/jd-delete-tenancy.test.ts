import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { deleteJd, listJdRevisions, listJdsPage, loadJd, saveJd, updateJd } from "./jobs.ts";

after(() => cleanupUnitDb());

// Behavioral tenant isolation for the JD DELETE door (the Ledger's trash icon).
// The source guard in jds-tenancy.test.ts proves the SQL names workspace_id; this
// proves the predicate actually binds — a delete is the one operation whose failure
// mode cannot be inspected afterwards, so "it was scoped" has to be demonstrated
// rather than read off the query text.

test("a JD cannot be deleted from another workspace", () => {
  const a = saveJd({ title: "Team A draft", body: "body A" }, "ws-del-a");
  // Give it a revision, so a cross-tenant sweep of jd_revisions would show up too.
  updateJd(a.slug, { title: "Team A draft", body: "body A v2" }, undefined, "ws-del-a");
  assert.equal(listJdRevisions(a.slug, 30, "ws-del-a").length, 1, "the edit filed one revision");

  assert.equal(deleteJd(a.slug, "ws-del-b"), false, "team B's delete must report no row removed");
  assert.ok(loadJd(a.slug, "ws-del-a"), "team A's JD still exists");
  assert.equal(
    listJdRevisions(a.slug, 30, "ws-del-a").length,
    1,
    "and its history is intact — a foreign delete must not sweep revisions on a 404",
  );
});

test("a delete in the owning workspace removes the row and its revisions", () => {
  const jd = saveJd({ title: "Own draft", body: "v1" }, "ws-del-own");
  updateJd(jd.slug, { title: "Own draft", body: "v2" }, undefined, "ws-del-own");
  assert.equal(listJdRevisions(jd.slug, 30, "ws-del-own").length, 1);

  assert.equal(deleteJd(jd.slug, "ws-del-own"), true);
  assert.equal(loadJd(jd.slug, "ws-del-own"), null, "the row is gone");
  assert.equal(listJdRevisions(jd.slug, 30, "ws-del-own").length, 0, "the history went with it");
  assert.ok(
    !listJdsPage(100, "ws-del-own").jds.some((j) => j.slug === jd.slug),
    "and it leaves the library listing",
  );
});

test("deleting a slug that does not exist is a false, not a throw", () => {
  assert.equal(deleteJd("no-such-jd-slug", "ws-del-own"), false);
});

test("created_by is stamped at insert and read back by the list + detail paths", () => {
  const mine = saveJd({ title: "Mine", body: "b" }, "ws-del-who", "user-1");
  const legacy = saveJd({ title: "Legacy", body: "b" }, "ws-del-who");

  assert.equal(loadJd(mine.slug, "ws-del-who")?.created_by, "user-1");
  // A save with no identity behind it (open dev, an operator-password session)
  // leaves NULL — "no creator claim", which canDeleteJd matches to nobody.
  assert.equal(loadJd(legacy.slug, "ws-del-who")?.created_by ?? null, null);

  const listed = listJdsPage(100, "ws-del-who").jds;
  assert.equal(listed.find((j) => j.slug === mine.slug)?.created_by, "user-1");
});
