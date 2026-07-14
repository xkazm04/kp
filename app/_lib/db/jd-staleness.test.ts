// Direction 2 — jdLastEditedAt is the honest "when did the body last change?"
// source that lets the candidate roster flag analyses scored against stale JD text.
// A never-edited JD returns null (roster shows nothing); an edit (and a revert,
// which is itself an edit) advances it. Workspace-scoped.
//
//   npm run test:unit
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { saveJd, updateJd, revertJd, listJdRevisions, jdLastEditedAt } from "./jobs.ts";

after(() => cleanupUnitDb());

test("a never-edited JD has no last-edited timestamp", () => {
  const jd = saveJd({ title: "Fresh", body: "v1" }, "ws-a");
  assert.equal(jdLastEditedAt(jd.slug, "ws-a"), null);
});

test("an edit advances the last-edited timestamp; a revert counts as a change", () => {
  const jd = saveJd({ title: "Role", body: "v1" }, "ws-a");

  const ok1 = updateJd(jd.slug, { title: "Role", body: "v2" }, undefined, "ws-a");
  assert.deepEqual(ok1, { ok: true });
  const afterEdit = jdLastEditedAt(jd.slug, "ws-a");
  assert.ok(afterEdit, "an edited JD has a last-edited timestamp");

  // A revert snapshots the current body first, so it too advances the marker.
  const revId = listJdRevisions(jd.slug, 30, "ws-a")[0].id;
  const rev = revertJd(jd.slug, revId, undefined, "ws-a");
  assert.equal(rev.ok, true);
  const afterRevert = jdLastEditedAt(jd.slug, "ws-a");
  assert.ok(afterRevert && afterRevert >= afterEdit, "a revert advances (or holds) the last-edited timestamp");
});

test("the last-edited read is workspace-scoped", () => {
  const jd = saveJd({ title: "Scoped", body: "v1" }, "ws-a");
  updateJd(jd.slug, { title: "Scoped", body: "v2" }, undefined, "ws-a");
  assert.ok(jdLastEditedAt(jd.slug, "ws-a"), "owner sees the edit");
  assert.equal(jdLastEditedAt(jd.slug, "ws-b"), null, "another team sees no edit history");
});
