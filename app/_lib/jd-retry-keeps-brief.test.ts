// The JD retry's row-fallback replay (task row pruned) rebuilds from the persisted
// build intent. Promote used to persist an intent with no brief, so the replayed
// role lost its must-have stack, responsibilities, stated requirements and stated
// languages (a stated language is a ko_lang knockout, ADR 0019). The intent now
// carries the brief and replayParamsFromIntent hands it back.
//
//   npm run test:unit
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { insertAnalyzingJd, loadJd, type JdBuildIntent } from "./db/jobs.ts";
import { replayParamsFromIntent } from "./jd-build-start.ts";
import type { RoleBrief } from "./rolespec.ts";

after(() => cleanupUnitDb());

const BRIEF: RoleBrief = {
  schemaVersion: 1,
  title: "Platform Engineer",
  seniority: "senior",
  roleFamily: "software_engineering",
  languages: ["Czech"],
  summary: "Lead the EU data-residency migration.",
  responsibilities: ["Own the migration plan"],
  successCriteria: ["Migration done in the first 90 days"],
  requirements: [
    { skill: "PostgreSQL", kind: "must_have", hardness: "prerequisite", weight: 3, rationale: "core store", provenance: "stated", confidence: 0.9 },
    { skill: "Kubernetes", kind: "must_have", hardness: "learnable", weight: 2, rationale: "runtime", provenance: "stated", confidence: 0.8 },
  ],
};

// Built the way POST /api/intake/[id]/promote builds it.
function promoteIntent(): { buildInput: JdBuildIntent; params: Record<string, unknown> } {
  const options = { description: true, marketResearch: true, caseDesign: false };
  const needText = "Need: platform engineer";
  const lang = "cs";
  const company = "Acme";
  return {
    buildInput: { needText, company, seniority: BRIEF.seniority, roleFamily: BRIEF.roleFamily, lang, options, brief: BRIEF },
    params: { company, seniority: BRIEF.seniority, roleFamily: BRIEF.roleFamily, needText, brief: BRIEF, lang },
  };
}

function replay(buildInput: JdBuildIntent | Record<string, unknown>) {
  const ws = "ws-a";
  const { slug } = insertAnalyzingJd({ title: "Platform Engineer", options: {}, buildInput: buildInput as JdBuildIntent }, ws);
  const row = loadJd(slug, ws);
  assert.ok(row, "the analyzing JD loads in its workspace");
  return replayParamsFromIntent(row!.title, row!.build_input_json, () => undefined);
}

test("a promoted JD replays with its brief, deep-equal, and promote's other params", () => {
  const { buildInput, params } = promoteIntent();
  const replayed = replay(buildInput);
  assert.ok(replayed);
  assert.deepEqual(replayed!.brief, BRIEF);
  for (const key of ["needText", "seniority", "roleFamily", "lang", "company"]) {
    assert.equal(replayed![key], params[key], key);
  }
  assert.deepEqual(replayed!.options, buildInput.options);
});

test("a legacy intent with no brief replays with no brief key", () => {
  const replayed = replay({
    needText: "Hire a platform engineer",
    company: "Acme",
    seniority: "senior",
    roleFamily: "software_engineering",
    lang: "en",
    options: { description: true },
  });
  assert.ok(replayed);
  assert.equal("brief" in replayed!, false);
  assert.deepEqual(replayed, {
    title: "Platform Engineer",
    company: "Acme",
    seniority: "senior",
    roleFamily: "software_engineering",
    needText: "Hire a platform engineer",
    repoUrl: undefined,
    lang: "en",
    templateBody: undefined,
    options: { description: true },
  });
});

test("a brief that is a string, an array or null is omitted", () => {
  for (const bad of ["a brief", ["x"], null, 7]) {
    const replayed = replay({ needText: "n", brief: bad });
    assert.ok(replayed);
    assert.equal("brief" in replayed!, false, `omitted for ${JSON.stringify(bad)}`);
  }
});

test("a blank or unparseable intent still yields null", () => {
  assert.equal(replayParamsFromIntent("t", null, () => undefined), null);
  assert.equal(replayParamsFromIntent("t", "{not json", () => undefined), null);
});

test("the template body comes from the caller's resolver, only for a stored templateId", () => {
  const seen: string[] = [];
  const resolve = (id: string) => (seen.push(id), `body-of-${id}`);
  const withTpl = replay({ needText: "n", templateId: "tpl-1" });
  assert.equal(withTpl!.templateBody, undefined, "the helper's default resolver yields nothing");
  const { slug } = insertAnalyzingJd({ title: "T", options: {}, buildInput: { needText: "n", templateId: "tpl-1" } }, "ws-a");
  const replayed = replayParamsFromIntent("T", loadJd(slug, "ws-a")!.build_input_json, resolve);
  assert.equal(replayed!.templateBody, "body-of-tpl-1");
  assert.deepEqual(seen, ["tpl-1"]);
});
