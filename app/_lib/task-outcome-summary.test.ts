// The outcome table's exhaustiveness + the mappers + the deep link.
//
// The first test is the one that matters over time: it reads the HANDLERS table
// out of tasks.ts (the single registry of task kinds) and fails when a kind is
// neither mapped in TABLE nor listed in NO_TABLE_SUMMARY with a reason. Before
// this file, sixteen of the seventeen kinds fell through a generic
// `Object.entries(result)` dump — raw handler keys in mono, values stringified —
// and nothing said so. A new kind must now decide what its drawer says.
//
// Runner: node:test, via `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  APPLIED_VALUES,
  NO_TABLE_SUMMARY,
  SUMMARIZED_KINDS,
  genericOutcomeLines,
  taskOutcomeLink,
  taskOutcomeSummary,
} from "./task-outcome-summary.ts";

/** The kind ids as tasks.ts declares them — parsed rather than imported because
 *  tasks.ts pulls in better-sqlite3 and the whole handler graph. */
function handlerKinds(): string[] {
  const src = readFileSync(fileURLToPath(new URL("./tasks.ts", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  const at = src.indexOf("const HANDLERS: Record<string, Spec> = {");
  assert.ok(at > 0, "expected the HANDLERS registry in tasks.ts");
  const body = src.slice(at, src.indexOf("\n};", at));
  // Top-level keys only: a registry entry is indented exactly two spaces.
  return [...body.matchAll(/^ {2}([a-z_]+): \{$/gm)].map((m) => m[1]);
}

test("every task kind either has an outcome mapper or a stated reason not to", () => {
  const kinds = handlerKinds();
  assert.ok(kinds.length >= 15, `expected the full HANDLERS registry, parsed ${kinds.length}`);
  const missing = kinds.filter((k) => !SUMMARIZED_KINDS.includes(k) && !(k in NO_TABLE_SUMMARY));
  assert.deepEqual(missing, [], "these kinds would fall through to the generic allowlist with nothing said about it");
  for (const [kind, reason] of Object.entries(NO_TABLE_SUMMARY)) {
    assert.ok(kinds.includes(kind), `${kind} is excused but is not a task kind any more`);
    assert.ok(reason.length > 10, `${kind}'s exemption must state a reason`);
  }
});

test("no mapper leaks a blob or a raw handler key", () => {
  // The exact defect: jd_build's result carries the whole generated JD under
  // `markdown`, reasoning's carries the full rationale payload. A line's literal
  // value must be a scalar the drawer can print, never a document.
  const lines = taskOutcomeSummary("jd_build", { markdown: "# Senior Backend Engineer\n".repeat(400), case: { brief: "x" } });
  assert.deepEqual(lines, [{ labelKey: "caseIncluded", valueKey: "yes" }]);
  for (const l of taskOutcomeSummary("reasoning", { cached: true, narrativeLang: "en", rationale: { a: 1 } })) {
    assert.ok(typeof l.value !== "object", "a line's value is never an object");
    assert.ok(String(l.value ?? l.valueKey).length < 60, "a line's value is never a document");
  }
});

test("mappers pick the fact, defensively", () => {
  assert.deepEqual(taskOutcomeSummary("automation", { applied: "held_for_review", source: "llm" }), [
    { labelKey: "outcome", valueKey: "held_for_review" },
    { labelKey: "source", valueKey: "llm" },
  ]);
  // A vocabulary this build has no word for produces NO line — never a raw token.
  assert.deepEqual(taskOutcomeSummary("automation", { applied: "teleported", source: "vibes" }), []);
  assert.deepEqual(taskOutcomeSummary("reasoning", { cached: false, narrativeLang: "cs" }), [
    { labelKey: "freshness", valueKey: "fresh" },
    { labelKey: "language", value: "cs" },
  ]);
  assert.deepEqual(taskOutcomeSummary("batch_outreach", { ok: 7, total: 9, results: [] }), [
    { labelKey: "drafted", value: "7 / 9" },
    { labelKey: "failures", value: 2 },
  ]);
  assert.deepEqual(taskOutcomeSummary("analyze", { persistence: { slug: "ada-l" }, servedFromCache: true }), [
    { labelKey: "savedAs", value: "ada-l" },
    { labelKey: "freshness", valueKey: "cached" },
  ]);
  assert.deepEqual(taskOutcomeSummary("group_eval", { recommendedOrder: ["a", "b", "c"], lead: { label: "Ada" }, comparisonSource: "deterministic" }), [
    { labelKey: "candidates", value: 3 },
    { labelKey: "lead", value: "Ada" },
    { labelKey: "source", valueKey: "deterministic" },
  ]);
  assert.deepEqual(taskOutcomeSummary("design_artifacts", { source: "llm", case: {} }), [
    { labelKey: "source", valueKey: "llm" },
    { labelKey: "caseIncluded", valueKey: "no" },
  ]);
  assert.deepEqual(taskOutcomeSummary("evaluate_submission", { followups: { questions: [1, 2] } }), [
    { labelKey: "followups", value: 2 },
  ]);
  assert.deepEqual(taskOutcomeSummary("campaign", { pack: { source: "heuristic" } }), [{ labelKey: "source", valueKey: "heuristic" }]);
  // A result from an older row, missing everything the mapper wants: no lines, no throw.
  for (const kind of SUMMARIZED_KINDS) assert.deepEqual(taskOutcomeSummary(kind, {}), [], `${kind} must degrade to no lines`);
  // Not an object at all (null result, a bare string) — still no lines, no throw.
  for (const bad of [null, undefined, "done", 3, []]) assert.deepEqual(taskOutcomeSummary("analyze", bad), []);
});

test("the generic fallback is an allowlist, not a dump", () => {
  const lines = genericOutcomeLines({
    source: "llm",
    applied: "sent",
    ok: 2,
    total: 2,
    cached: false,
    markdown: "# a whole document",
    narrativeLang: "en",
    secretInternalId: "wsp_1",
  });
  assert.deepEqual(lines, [
    { labelKey: "outcome", valueKey: "sent" },
    { labelKey: "source", valueKey: "llm" },
    { labelKey: "drafted", value: "2 / 2" },
    { labelKey: "freshness", valueKey: "fresh" },
  ]);
  // An unmapped kind routes through it, and still shows nothing unlisted.
  assert.deepEqual(taskOutcomeSummary("a_kind_this_build_dropped", { markdown: "x", source: "llm" }), [
    { labelKey: "source", valueKey: "llm" },
  ]);
});

test("APPLIED_VALUES covers the vocabulary automation-run.ts actually emits", () => {
  const src = readFileSync(fileURLToPath(new URL("./automation-run.ts", import.meta.url)), "utf8");
  const stages = readFileSync(fileURLToPath(new URL("./pipeline-stages.ts", import.meta.url)), "utf8");
  const emitted = new Set<string>();
  for (const m of `${src}\n${stages}`.matchAll(/applied(?:: |\s*=\s*)"([a-z_]+)"/g)) emitted.add(m[1]);
  for (const m of `${src}\n${stages}`.matchAll(/applied: cleared \? "([a-z_]+)" : "([a-z_]+)"/g)) {
    emitted.add(m[1]);
    emitted.add(m[2]);
  }
  assert.ok(emitted.size >= 10, `expected the applied vocabulary, found ${emitted.size}`);
  const unknown = [...emitted].filter((v) => !(APPLIED_VALUES as readonly string[]).includes(v));
  assert.deepEqual(unknown, [], "an emitted `applied` value with no entry here renders as nothing at all");
});

test("the outcome deep link routes each kind back to its entity", () => {
  const base = { id: "t1", params: null as unknown, result: null as unknown };
  assert.deepEqual(taskOutcomeLink({ ...base, kind: "analyze", result: { persistence: { slug: "a b" } } }), {
    href: "/history/a%20b",
    key: "openSavedReport",
  });
  // No saved report ⇒ no link, rather than a link to /history/undefined.
  assert.equal(taskOutcomeLink({ ...base, kind: "analyze", result: {} }), null);
  // The builder moved to the Job-intake tab; the `jdTask` param is also what makes
  // that tab open on Generate rather than the intake dialog (jdsIntakeTabEntry.ts).
  assert.deepEqual(taskOutcomeLink({ ...base, kind: "jd_build" }), {
    href: "/?tab=intake&jdTask=t1",
    key: "openJdLibrary",
  });
  assert.deepEqual(taskOutcomeLink({ ...base, kind: "group_eval", params: { jobId: "job-1" } }), {
    href: "/?tab=decisions&job=job-1",
    key: "openRoleDecisions",
  });
  assert.deepEqual(taskOutcomeLink({ ...base, kind: "group_eval", params: {} }), {
    href: "/?tab=decisions",
    key: "openDecisions",
  });
  assert.deepEqual(taskOutcomeLink({ ...base, kind: "batch_screen" }), { href: "/?tab=decisions", key: "reviewInDecisions" });
  assert.deepEqual(taskOutcomeLink({ ...base, kind: "interview_prep" }), { href: "/?tab=schedule", key: "openSchedule" });
  assert.deepEqual(taskOutcomeLink({ ...base, kind: "automation", params: { entryLabel: "Ada L" } }), {
    href: "/?tab=pipeline&q=Ada%20L",
    key: "openBoard",
  });
  assert.equal(taskOutcomeLink({ ...base, kind: "companion_digest" }), null);
});
