import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRoleTrace, lineOrigin, roleTraceTokens, statedLanguages, traceRoleLines, authorInputTokens } from "./jd-role-trace.ts";

const spec = (over: Record<string, string[]>) => ({
  title: "Platform Engineer",
  mustHaves: [],
  niceToHaves: [],
  responsibilities: [],
  languages: [],
  ...over,
});

test("a short item the author wrote is 'brief'; one the build supplied is 'added'", () => {
  const lines = traceRoleLines(spec({ mustHaves: ["TypeScript", "Kubernetes"] }), {
    title: "Platform Engineer",
    needText: "We need someone strong in typescript and Postgres.",
  });
  assert.deepEqual(lines.map((l) => [l.text, l.origin]), [["TypeScript", "brief"], ["Kubernetes", "added"]]);
});

test("a sentence matches on content-word overlap, not on exact wording", () => {
  const input = { title: "Data Engineer", needText: "Own the ingest pipeline and keep nightly batch jobs reliable." };
  const lines = traceRoleLines(
    spec({ responsibilities: ["Own the ingest pipeline end to end", "Lead the quarterly security audit programme"] }),
    input,
  );
  assert.equal(lines[0].origin, "brief");
  assert.equal(lines[1].origin, "added");
});

test("Czech input with diacritics matches across accents and case", () => {
  const input = { title: "Vývojář", needText: "Hledáme Řízení projektů a znalost češtiny, Python nutný." };
  assert.deepEqual(roleTraceTokens("Řízení"), ["rizeni"]);
  const lines = traceRoleLines(spec({ mustHaves: ["PYTHON", "řízení projektů"], languages: ["Čeština", "Angličtina"] }), input);
  assert.deepEqual(lines.map((l) => l.origin), ["brief", "brief", "added", "added"]);
});

test("c++ and c# are not 'c'", () => {
  const input = { title: "x", needText: "We write C in the kernel" };
  assert.equal(lineOrigin("C++", authorInputTokens(input)), "added");
  assert.equal(lineOrigin("C", authorInputTokens(input)), "brief");
});

test("empty input makes every line 'added'; empty lines are skipped", () => {
  const lines = traceRoleLines(spec({ mustHaves: ["TypeScript", "  "], languages: ["English"] }), { title: "", needText: "" });
  assert.deepEqual(lines.map((l) => l.origin), ["added", "added"]);
  assert.deepEqual(traceRoleLines(null, { title: "a" }), []);
});

test("a long line with fewer than two content words is never 'brief'", () => {
  assert.equal(lineOrigin("and the with that", roleTraceTokens("and the with that")), "added");
});

test("brief fields count as the author's input, but the intake's rationale does not", () => {
  const brief = {
    title: "Analyst",
    languages: ["Czech"],
    requirements: [{ skill: "dbt", kind: "must_have", hardness: "prerequisite", weight: 1, rationale: "kubernetes", provenance: "", confidence: 1 }],
    facets: [{ key: "k", label: "Team", value: "works with Airflow", importance: "high" }],
  };
  const lines = traceRoleLines(spec({ mustHaves: ["dbt", "Airflow", "kubernetes"] }), { title: "Analyst", needText: "", brief: brief as never });
  assert.deepEqual(lines.map((l) => l.origin), ["brief", "brief", "added"]);
});

test("statedLanguages: the brief wins; otherwise only languages the author mentioned survive", () => {
  assert.deepEqual(statedLanguages(["English"], { title: "x", needText: "y", brief: { languages: ["Czech"] } as never }), ["Czech"]);
  assert.deepEqual(statedLanguages(["English", "German"], { title: "x", needText: "German speaking team" }), ["German"]);
  assert.deepEqual(statedLanguages(["English"], { title: "Backend Engineer", needText: "Build services" }), []);
  assert.deepEqual(statedLanguages(undefined, { title: "x", needText: "" }), []);
});

test("buildRoleTrace says whether the model or the keyless fallback designed the role", () => {
  const fallback = buildRoleTrace(spec({}) as never, { title: "x" }, { source: "deterministic", perStepSources: { role: "deterministic" } });
  assert.equal(fallback.designedBy, "fallback");
  const model = buildRoleTrace(spec({}) as never, { title: "x" }, { source: "claude", perStepSources: { role: "claude" } });
  assert.equal(model.designedBy, "model");
});
