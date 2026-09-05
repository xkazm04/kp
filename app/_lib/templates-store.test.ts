import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import {
  countTemplates,
  createTemplate,
  deleteTemplate,
  editTemplate,
  getTemplate,
  listTemplates,
  setDefaultTemplate,
  TEMPLATE_LIST_DEFAULT_LIMIT,
  TEMPLATE_LIST_MAX_LIMIT,
} from "./templates-store.ts";

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
  const other = listTemplates("ws-nf-b").templates.find((t) => t.scope === "team")!;
  const r = editTemplate(other.id, { name: "hacked" }, "ws-nf-a");
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "notFound");
  assert.equal(editTemplate("tpl-does-not-exist", { name: "x" }, "ws-nf-a").ok, false);
});

test("delete refuses with a REASON: notFound, the last visible template, and the org default", () => {
  const ws = "ws-del";
  // The seeded org baseline ("Company standard") is the only visible template here.
  const visible = listTemplates(ws).templates;
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

// The list had no bound at all — every visible row, each carrying a full markdown BODY,
// on every JD-builder mount and every open of the manager. These pin the bound AND the
// honesty flag: a silently cut list tells a team its library is smaller than it is.
test("the template list is bounded, clamps a caller's limit, and says when it cut", () => {
  const ws = "ws-tpl-bound";
  for (let i = 0; i < 6; i++) createTemplate({ name: `Bounded ${i}`, body: "# body" }, ws);

  const page = listTemplates(ws, 3);
  assert.equal(page.templates.length, 3, "the limit is honoured");
  assert.equal(page.truncated, true, "and the caller is told there is more");

  // A page that exactly fits is NOT truncated — the read looks one row past the bound
  // rather than inferring "there is more" from a full page.
  const all = listTemplates(ws, TEMPLATE_LIST_MAX_LIMIT);
  assert.equal(all.truncated, false);
  const exact = listTemplates(ws, all.templates.length);
  assert.equal(exact.truncated, false, "a full page is not evidence of a next one");

  // The caller's number is clamped at both ends: an unclamped caller-supplied limit is
  // the missing bound with extra steps.
  assert.equal(listTemplates(ws, 0).templates.length, 1, "below 1 clamps up to 1");
  assert.equal(listTemplates(ws, -5).templates.length, 1);
  assert.equal(listTemplates(ws, 10_000).templates.length, all.templates.length, "above MAX clamps down");
  assert.equal(listTemplates(ws, Number.NaN).templates.length, all.templates.length, "an unusable limit takes the default");
  assert.ok(TEMPLATE_LIST_DEFAULT_LIMIT <= TEMPLATE_LIST_MAX_LIMIT);

  // The bound does not change WHICH templates lead: the default still comes first.
  assert.equal(listTemplates(ws, 1).templates[0].isDefault, true);
});

test("countTemplates is a real count, not the bounded page's length", () => {
  const ws = "ws-tpl-count";
  for (let i = 0; i < 4; i++) createTemplate({ name: `Counted ${i}`, body: "# b" }, ws);
  const visible = listTemplates(ws, TEMPLATE_LIST_MAX_LIMIT).templates.length;
  assert.equal(countTemplates(ws), visible);
  // The palette's library preview reads this to say how big the library IS, so it must
  // not shrink to the page size the way the JD total once did.
  assert.ok(countTemplates(ws) > listTemplates(ws, 2).templates.length);
  // Same visibility rule as the list: org-shared + this team's own, never another team's.
  createTemplate({ name: "Elsewhere", body: "# b" }, "ws-tpl-count-other");
  assert.equal(countTemplates(ws), visible, "another team's private draft is not counted");
});
