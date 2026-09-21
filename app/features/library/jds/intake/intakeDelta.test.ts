// The brief diff behind the studio's per-turn arrival. It is pinned here rather
// than watched in a browser because the wire gives no patch — one exchange returns
// the WHOLE brief — so "these three rows are what your last sentence bought" is a
// claim this module invents, and a wrong one is a lie told with an animation.

import test from "node:test";
import assert from "node:assert/strict";
import type { RoleBrief } from "@/app/_lib/rolespec";
import { diffBrief, diffDraft, normalizeKey } from "./intakeDelta.ts";

const keys = (rows: { key: string }[]) => rows.map((r) => r.key);

const req = (skill: string, over: Record<string, unknown> = {}) => ({
  skill,
  kind: "must_have",
  hardness: "hard",
  weight: 1,
  rationale: "",
  provenance: "stated",
  confidence: 1,
  sourceTurn: 3,
  ...over,
});

const facet = (key: string, value: string, over: Record<string, unknown> = {}) => ({
  key,
  label: key,
  value,
  importance: "signal",
  provenance: "stated",
  confidence: 1,
  sourceTurn: 5,
  ...over,
});

test("no previous snapshot: every row is an arrival, carrying its own cited turn", () => {
  const next = {
    title: "Backend engineer",
    seniority: "senior",
    successCriteria: ["Ships the migration"],
    requirements: [req("Go")],
    facets: [facet("team_size", "six")],
  } as RoleBrief;

  const d = diffBrief(null, next);
  assert.deepEqual(d.changed, []);
  assert.deepEqual(d.removed, []);
  // Section order is the walk order, so the assertion names it explicitly.
  assert.deepEqual(keys(d.added), ["title", "seniority", "go", "ships the migration", "team_size"]);
  // The citation rides along: a requirement's `sourceTurn`, and null for a spine
  // scalar, which the engine never cites.
  assert.equal(d.added.find((r) => r.key === "go")?.sourceTurn, 3);
  assert.equal(d.added.find((r) => r.key === "team_size")?.sourceTurn, 5);
  assert.equal(d.added.find((r) => r.key === "title")?.sourceTurn, null);
});

test("an unchanged brief moves nothing", () => {
  const brief = { title: "Backend engineer", requirements: [req("Go")], facets: [facet("team_size", "six")] } as RoleBrief;
  const d = diffBrief(brief, { ...brief });
  assert.deepEqual(d, { added: [], changed: [], removed: [] });
});

test("re-ordering the arrays is not a change — identity is the key, never the index", () => {
  const prev = { requirements: [req("Go"), req("Kubernetes")] } as RoleBrief;
  const next = { requirements: [req("Kubernetes"), req("Go")] } as RoleBrief;
  assert.deepEqual(diffBrief(prev, next), { added: [], changed: [], removed: [] });
});

test("a regrading is a change, not an arrival", () => {
  const prev = { requirements: [req("Go", { weight: 1 })] } as RoleBrief;
  const next = { requirements: [req("Go", { weight: 3, rationale: "named twice" })] } as RoleBrief;
  const d = diffBrief(prev, next);
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.removed, []);
  assert.deepEqual(keys(d.changed), ["go"]);
});

test("a facet is identified by its KEY, so rewriting its value is a change", () => {
  const prev = { facets: [facet("budget_band", "1.2M CZK")] } as RoleBrief;
  const next = { facets: [facet("budget_band", "1.5M CZK")] } as RoleBrief;
  const d = diffBrief(prev, next);
  assert.deepEqual(keys(d.changed), ["budget_band"]);
  assert.deepEqual(d.added, []);
});

test("a dropped row is removed, and a genuinely new one is added", () => {
  const prev = { requirements: [req("Go"), req("Kubernetes")] } as RoleBrief;
  const next = { requirements: [req("Go"), req("Kubernetes"), req("Terraform")] } as RoleBrief;
  assert.deepEqual(keys(diffBrief(prev, next).added), ["terraform"]);

  const shrunk = { requirements: [req("Go")] } as RoleBrief;
  const d = diffBrief(prev, shrunk);
  assert.deepEqual(keys(d.removed), ["kubernetes"]);
  assert.deepEqual(d.added, []);
});

test("POSITIONAL FALLBACK: a rename at the same index is one changed row, not a delete plus an arrival", () => {
  const prev = { requirements: [req("Go"), req("React")] } as RoleBrief;
  const next = { requirements: [req("Go"), req("React Native")] } as RoleBrief;
  const d = diffBrief(prev, next);
  assert.deepEqual(d.added, [], "the renamed row must not read as brand-new work");
  assert.deepEqual(d.removed, [], "and the old name must not read as a deletion");
  assert.deepEqual(keys(d.changed), ["react native"], "it is the SAME row, under its new name");
});

test("…but only at the same index: an insert above a delete is still both", () => {
  const prev = { requirements: [req("Go"), req("React")] } as RoleBrief;
  const next = { requirements: [req("Rust"), req("Go")] } as RoleBrief;
  const d = diffBrief(prev, next);
  assert.deepEqual(keys(d.added), ["rust"]);
  assert.deepEqual(keys(d.removed), ["react"]);
  assert.deepEqual(d.changed, []);
});

test("the fallback carries the NEW row's citation, and works for prose sections too", () => {
  const prev = { successCriteria: ["Ships the migration"] } as RoleBrief;
  const next = { successCriteria: ["Ships the migration in 90 days"] } as RoleBrief;
  const d = diffBrief(prev, next);
  assert.deepEqual(keys(d.changed), ["ships the migration in 90 days"]);
  assert.deepEqual(d.added, []);
});

test("an emptied spine scalar is a removal; a first value is an arrival", () => {
  assert.deepEqual(keys(diffBrief({ summary: "Owns the platform" } as RoleBrief, {} as RoleBrief).removed), ["summary"]);
  assert.deepEqual(keys(diffBrief({} as RoleBrief, { summary: "Owns the platform" } as RoleBrief).added), ["summary"]);
});

test("languages read as one spine line, so adding one is a change to that line", () => {
  const d = diffBrief({ languages: ["Czech"] } as RoleBrief, { languages: ["Czech", "English"] } as RoleBrief);
  assert.deepEqual(keys(d.changed), ["languages"]);
});

test("normalizeKey folds case and whitespace, so the render walk and the diff agree", () => {
  assert.equal(normalizeKey("  React   Native "), "react native");
  assert.equal(normalizeKey("React native"), normalizeKey("REACT  NATIVE"));
});

test("diffDraft: a line the document did not hold before is added", () => {
  const prev = ["# Backend engineer", "", "## What you'll bring", "- Go"];
  const next = ["# Backend engineer", "", "## What you'll bring", "- Go", "- Kubernetes"];
  assert.deepEqual(diffDraft(prev, next), { added: [4], changed: [] });
});

test("diffDraft: a line that replaced the one in its slot is changed, not added", () => {
  const prev = ["# Backend engineer", "- Go"];
  const next = ["# Backend engineer", "- Rust"];
  assert.deepEqual(diffDraft(prev, next), { added: [], changed: [1] });
});

test("diffDraft: an unchanged document reports nothing, blank lines included", () => {
  const doc = ["# Role", "", "- Go", "", "- Rust"];
  assert.deepEqual(diffDraft(doc, [...doc]), { added: [], changed: [] });
});

test("diffDraft: a repeated line is counted, so the second copy is genuinely new", () => {
  assert.deepEqual(diffDraft(["- Go"], ["- Go", "- Go"]), { added: [1], changed: [] });
});
