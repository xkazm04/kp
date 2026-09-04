import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createTemplate, deleteTemplate, editTemplate, getTemplate, listTemplates, setDefaultTemplate } from "./templates-store.ts";

after(() => cleanupUnitDb());

// The template CRUD had no test of its own: the two existing files
// (templates-isolation, db-portability-*) only exercise tenancy. What is pinned
// here is the part a recruiter meets — the REFUSALS (machine reasons, never
// prose) and the compare-and-swap that stops one editor erasing another's save.
//
//   node scripts/run-unit-tests.mjs app/_lib/templates-store.test.ts

test("an edit with the loaded stamp wins; the SAME stamp replayed after it is a conflict", () => {
  const ws = "ws-cas";
  const t0 = createTemplate({ name: "Draft", body: "{{role}}", scope: "team" }, ws);

  const first = editTemplate(t0.id, { body: "first writer {{role}}", expectedUpdatedAt: t0.updatedAt }, ws);
  assert.equal(first.ok, true, "the first save carries the stamp it loaded and is accepted");
  assert.ok(first.ok && first.template.updatedAt !== t0.updatedAt, "an accepted write MOVES the stamp — it is the CAS token");

  // The second recruiter loaded the same row before the first save landed.
  const second = editTemplate(t0.id, { body: "second writer {{role}}", expectedUpdatedAt: t0.updatedAt }, ws);
  assert.equal(second.ok, false, "a stale base stamp is refused, not silently applied");
  assert.equal(second.ok === false && second.reason, "conflict");
  // The refusal hands back the winning row so the client can reload it rather than re-fetch.
  assert.equal(second.ok === false && second.template?.body, "first writer {{role}}");
  assert.equal(getTemplate(t0.id, ws)?.body, "first writer {{role}}", "the first writer's body survives");
});

test("an edit with no expected stamp stays unconditional (the pre-CAS callers)", () => {
  const ws = "ws-nocas";
  const t0 = createTemplate({ name: "Draft", body: "a {{role}}", scope: "team" }, ws);
  editTemplate(t0.id, { body: "b {{role}}", expectedUpdatedAt: t0.updatedAt }, ws);
  const r = editTemplate(t0.id, { body: "c {{role}}" }, ws);
  assert.equal(r.ok, true);
  assert.equal(getTemplate(t0.id, ws)?.body, "c {{role}}");
});

test("editing a template this team cannot see is notFound, never a silent no-op success", () => {
  createTemplate({ name: "B private", body: "{{role}}", scope: "team" }, "ws-nf-b");
  const other = listTemplates("ws-nf-b").find((t) => t.scope === "team")!;
  const r = editTemplate(other.id, { name: "hacked" }, "ws-nf-a");
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "notFound");
  assert.equal(editTemplate("tpl-does-not-exist", { name: "x" }, "ws-nf-a").ok, false);
});

test("delete refuses with a REASON: notFound, the last visible template, and the org default", () => {
  const ws = "ws-del";
  // The seeded org baseline ("Company standard") is the only visible template here.
  const visible = listTemplates(ws);
  assert.equal(visible.length, 1, "fixture assumption: only the seeded org default is visible");

  const missing = deleteTemplate("tpl-nope", ws);
  assert.equal(missing.ok, false);
  assert.equal(missing.ok === false && missing.reason, "notFound", "a row that isn't there is notFound, not 'the last template'");

  const last = deleteTemplate(visible[0].id, ws);
  assert.equal(last.ok === false && last.reason, "last", "the last template a team can see is never deletable");

  // With a second template present, the default is refused for being the default.
  const extra = createTemplate({ name: "Second", body: "{{role}}", scope: "team" }, ws);
  const def = deleteTemplate(visible[0].id, ws);
  assert.equal(def.ok === false && def.reason, "default");
  assert.equal(deleteTemplate(extra.id, ws).ok, true, "a non-default template with a sibling deletes cleanly");
});

test("promoting a team-private draft to the org default is refused (org baseline only)", () => {
  const ws = "ws-def";
  const priv = createTemplate({ name: "Mine", body: "{{role}}", scope: "team" }, ws);
  assert.equal(setDefaultTemplate(priv.id, ws), null, "a private draft cannot become THE company default");
});
