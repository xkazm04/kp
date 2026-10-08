import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRoleTrace, droppedLanguages, ROLE_TRACE_RULE, lineOrigin, roleTraceTokens, statedLanguages, traceRoleLines, authorInputTokens } from "./jd-role-trace.ts";

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
  // Čeština is the SAME language as "češtiny" (identity, not tokens); Angličtina is never named.
  assert.deepEqual(lines.map((l) => l.origin), ["brief", "brief", "brief", "added"]);
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

const langs = (model: string[], needText: string) => statedLanguages(model, { title: "Engineer", needText });

test("the three council probes keep the language the author stated", () => {
  assert.deepEqual(langs(["Čeština"], "Znalost češtiny"), ["Čeština"]);
  assert.deepEqual(langs(["English"], "angličtina nutná"), ["English"]);
  assert.deepEqual(langs(["Angličtina"], "Fluent English required"), ["Angličtina"]);
});

test("a negated or unstated language is dropped", () => {
  assert.deepEqual(langs(["English"], "No English needed"), []);
  assert.deepEqual(langs(["Angličtina"], "bez angličtiny"), []);
  assert.deepEqual(langs(["English"], "angličtina není nutná"), []);
  assert.deepEqual(langs(["English"], "Build services and own the pipeline"), []);
});

test("'experience with the Czech market' states Czech (documented over-trust)", () => {
  assert.deepEqual(langs(["Czech"], "experience with the Czech market"), ["Czech"]);
});

test("a language outside the lexicon falls back to the overlap rule", () => {
  assert.deepEqual(langs(["Klingon", "Esperanto"], "Klingon speakers preferred"), ["Klingon"]);
});

test("the brief's languages still win outright", () => {
  assert.deepEqual(statedLanguages(["English"], { title: "x", needText: "English required", brief: { languages: ["Czech"] } as never }), ["Czech"]);
});

test("droppedLanguages records each removed language with its reason", () => {
  const dropped = (model: string[], needText: string, brief?: unknown) => droppedLanguages(model, { title: "x", needText, brief: brief as never });
  assert.deepEqual(dropped(["English", "German"], "No English needed"), [
    { text: "English", reason: "negated" },
    { text: "German", reason: "unstated" },
  ]);
  assert.deepEqual(dropped(["Čeština"], "Znalost češtiny"), []);
  assert.deepEqual(dropped(["English", "Czech"], "x", { languages: ["Čeština"] }), [{ text: "English", reason: "superseded" }]);
  assert.equal(buildRoleTrace(spec({}) as never, { title: "x", needText: "No English needed" }, {}, dropped(["English"], "No English needed")).droppedLanguages.length, 1);
  assert.equal(ROLE_TRACE_RULE, "overlap-v1+lang-v1");
});

test("the languages lines of the trace read 'brief' by identity, 'added' when negated", () => {
  const lines = traceRoleLines(spec({ languages: ["Čeština", "English"] }), { title: "x", needText: "znalost češtiny, bez angličtiny" });
  assert.deepEqual(lines.map((l) => l.origin), ["brief", "added"]);
});
