// Direction 3 — the recruiter's original build intent (prompt + options) must
// survive the build on the JD row, so Duplicate can re-seed the PROMPT and Retry
// can replay after the task row is pruned. Round-trips insertAnalyzingJd →
// loadJd, and confirms legacy rows (saveJd, no intent) read back NULL and stay
// workspace-scoped.
//
//   npm run test:unit
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { insertAnalyzingJd, loadJd, saveJd } from "./jobs.ts";

after(() => cleanupUnitDb());

test("insertAnalyzingJd persists the build intent; loadJd reads it back", () => {
  const intent = {
    needText: "Hire a senior platform engineer to lead our EU data-residency migration.",
    company: "Acme",
    seniority: "senior",
    roleFamily: "software_engineering",
    lang: "cs",
    templateId: "tpl-1",
    options: { description: true, marketResearch: true, caseDesign: false },
  };
  const { slug } = insertAnalyzingJd({ title: "Platform Engineer", options: intent.options, buildInput: intent }, "ws-a");

  const row = loadJd(slug, "ws-a");
  assert.ok(row, "the analyzing JD loads in its workspace");
  assert.ok(row!.build_input_json, "the row carries persisted build intent");
  const parsed = JSON.parse(row!.build_input_json!);
  assert.equal(parsed.needText, intent.needText, "the original prompt survives verbatim");
  assert.equal(parsed.templateId, "tpl-1");
  assert.equal(parsed.lang, "cs");
  assert.deepEqual(parsed.options, intent.options);
});

test("a plain draft save carries no intent (legacy-shaped NULL)", () => {
  const { slug } = saveJd({ title: "Manual draft", body: "pasted body" }, "ws-a");
  const row = loadJd(slug, "ws-a");
  assert.ok(row);
  assert.ok(row!.build_input_json == null, "a draft save has no build intent");
});

test("intent is workspace-scoped with the row", () => {
  const { slug } = insertAnalyzingJd({ title: "Scoped", options: {}, buildInput: { needText: "secret need" } }, "ws-a");
  assert.equal(loadJd(slug, "ws-b"), null, "another team cannot load the JD (or its intent) by slug");
});
