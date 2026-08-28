// ONE THREAD (gap 8) — the tone tables, pinned twice.
//
// The point of a shared tone vocabulary is that it is TOTAL: every value every axis
// can hold has a declared reading state. A tone table that quietly defaults is worse
// than five private palettes, because the reader now trusts one legend and the
// legend is silently wrong for the values nobody enumerated.
//
// So each axis is checked from both ends:
//   1. the tuple matches its PRODUCER (the orchestrator, the DB row type, the
//      StageRole union, the four label catalogs) — the same derive-don't-eyeball
//      rule devcase-vocabulary.test.ts was written to enforce;
//   2. the tone map is exhaustive over the tuple, and every declared value comes
//      back from the RESOLVER as its mapped tone rather than through the
//      unknown-value branch.
//
// Runner: node:test with type stripping — npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DEFAULT_STAGE_AXIS, PIPELINE_STAGES } from "./pipeline-stages.ts";
import {
  ASSIGNMENT_STAGES,
  ASSIGNMENT_STAGE_TONE,
  INTERVIEW_STATUSES,
  INTERVIEW_STATUS_TONE,
  JOB_STATUSES,
  JOB_STATUS_TONE,
  PIPELINE_ROLE_TONE,
  STATUS_TONES,
  SUBMISSION_STATUSES,
  SUBMISSION_STATUS_TONE,
  assignmentStageTone,
  interviewStatusTone,
  jobStatusTone,
  pipelineStageTone,
  submissionStatusTone,
  type StatusTone,
} from "./status-tone.ts";

// app/_lib/ -> repo root is two levels up.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...rel: string[]) => readFileSync(path.join(ROOT, ...rel), "utf8");
const LOCALES = ["en", "cs", "de", "fr"] as const;

type Json = { [key: string]: unknown };
/** A locale catalog, walked to `path`. Missing nodes answer `{}` so the set-equality
 *  assertion reports "MISSING every key" rather than throwing on the way there. */
function catalog(locale: string, ...segments: string[]): Json {
  let node: unknown = JSON.parse(read("messages", `${locale}.json`));
  for (const seg of segments) node = (node as Json | undefined)?.[seg];
  return (node ?? {}) as Json;
}

function assertSameSet(actual: readonly string[], expected: readonly string[], what: string) {
  const a = [...actual].sort();
  const e = [...expected].sort();
  assert.deepEqual(e.filter((k) => !a.includes(k)), [], `${what} is MISSING the above`);
  assert.deepEqual(a.filter((k) => !e.includes(k)), [], `${what} has EXTRA the above`);
}

// ---- 1. the tuples match their producers ------------------------------------

test("ASSIGNMENT_STAGES matches devcase-orchestrator.ts STAGES", () => {
  const src = read("app", "_lib", "devcase-orchestrator.ts");
  const m = src.match(/const STAGES = \[([^\]]*)\]/);
  assert.ok(m, "could not locate `const STAGES = [...]` — the orchestrator moved, so this guard is blind");
  assertSameSet(
    ASSIGNMENT_STAGES,
    [...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]),
    "status-tone.ASSIGNMENT_STAGES vs the orchestrator's STAGES — the orchestrator is the only writer, so a " +
      "stage it can set and this tuple cannot renders with no tone at all"
  );
});

test("JOB_STATUSES matches the JobRow.status union in db/core.ts", () => {
  const src = read("app", "_lib", "db", "core.ts");
  const m = src.match(/status\?:\s*((?:"[a-z]+"\s*\|\s*)+)null;/);
  assert.ok(m, "could not locate JobRow.status — the row type moved or the NULL member was dropped");
  assertSameSet(
    JOB_STATUSES,
    [...m![1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]),
    "status-tone.JOB_STATUSES vs JobRow.status"
  );
});

test("PIPELINE_ROLE_TONE covers exactly the StageRole union", () => {
  const src = read("app", "_lib", "pipeline-stages.ts");
  const m = src.match(/export type StageRole =([^;]*);/);
  assert.ok(m, "could not locate the StageRole union");
  assertSameSet(
    Object.keys(PIPELINE_ROLE_TONE),
    [...m![1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]),
    "status-tone.PIPELINE_ROLE_TONE vs StageRole — the board axis is workspace-editable, so a role with no " +
      "tone means a whole column of candidates renders unreadable"
  );
});

test("INTERVIEW_STATUSES matches the devcase.voiceScreen.status catalogs", () => {
  // The catalog is what turns these into words on the assignment surface; the tuple
  // is what gives them a colour. Drift either way and one of the two goes blank.
  for (const locale of LOCALES) {
    assertSameSet(
      Object.keys(catalog(locale, "devcase", "voiceScreen", "status")),
      INTERVIEW_STATUSES,
      `messages/${locale}.json devcase.voiceScreen.status vs status-tone.INTERVIEW_STATUSES`
    );
  }
});

test("SUBMISSION_STATUSES matches what dev_submissions is actually written with", () => {
  const src = read("app", "_lib", "db", "devcase.ts");
  for (const status of SUBMISSION_STATUSES) {
    assert.ok(src.includes(`'${status}'`), `db/devcase.ts never writes '${status}' — the tuple is guessing`);
  }
  // Non-vacuous in the other direction: a third literal would need a tone.
  assert.equal(SUBMISSION_STATUSES.length, 2, "dev_submissions gained a status — give it a tone");
  // …and a label, in all four catalogs. The submission row renders the chip through
  // `devcase.submissionStatus`, so a status with a tone and no word is a raw code
  // beside a candidate's name.
  for (const locale of LOCALES) {
    assertSameSet(
      Object.keys(catalog(locale, "devcase", "submissionStatus")),
      SUBMISSION_STATUSES,
      `messages/${locale}.json devcase.submissionStatus vs status-tone.SUBMISSION_STATUSES`
    );
  }
});

// ---- 2. every map is total, and the resolvers use it ------------------------

const AXES: Array<{
  name: string;
  values: readonly string[];
  map: Record<string, StatusTone>;
  resolve: (v: string) => StatusTone;
}> = [
  { name: "jobs.status", values: JOB_STATUSES, map: JOB_STATUS_TONE, resolve: jobStatusTone },
  { name: "assignment lifecycle", values: ASSIGNMENT_STAGES, map: ASSIGNMENT_STAGE_TONE, resolve: assignmentStageTone },
  { name: "interview session", values: INTERVIEW_STATUSES, map: INTERVIEW_STATUS_TONE, resolve: interviewStatusTone },
  { name: "submission", values: SUBMISSION_STATUSES, map: SUBMISSION_STATUS_TONE, resolve: submissionStatusTone },
];

for (const axis of AXES) {
  test(`${axis.name}: every value has a DECLARED tone (none falls through to the default)`, () => {
    assertSameSet(Object.keys(axis.map), axis.values, `${axis.name} tone map vs its vocabulary`);
    for (const v of axis.values) {
      assert.ok(Object.hasOwn(axis.map, v), `${axis.name} "${v}" has no declared tone`);
      assert.ok(
        (STATUS_TONES as readonly string[]).includes(axis.map[v]),
        `${axis.name} "${v}" is toned "${axis.map[v]}", which is not one of the five reading states`
      );
      assert.equal(
        axis.resolve(v),
        axis.map[v],
        `${axis.name} "${v}" resolves to "${axis.resolve(v)}" but is declared "${axis.map[v]}" — the resolver ` +
          `is taking the unknown-value branch for a value the product itself writes`
      );
    }
  });

  test(`${axis.name}: the axis is not uniformly neutral (a constant resolver would pass every other check)`, () => {
    const distinct = new Set(axis.values.map((v) => axis.map[v]));
    assert.ok(distinct.size > 1, `${axis.name} maps every value to the same tone — the chip would say nothing`);
  });
}

test("pipeline board: every default stage resolves through its role, and off-axis ids do not", () => {
  const tones = PIPELINE_STAGES.map((id) => pipelineStageTone(id));
  assert.deepEqual(tones, ["neutral", "active", "active", "waiting", "done"]);
  // A retired column / legacy row has no role, so it has no reading state to claim.
  assert.equal(pipelineStageTone("Sourced"), "neutral");
  assert.equal(pipelineStageTone(""), "neutral");
  // Renaming a column must not move its tone — the whole reason this axis is keyed
  // on role. Same roles, different labels AND different ids.
  const renamed = DEFAULT_STAGE_AXIS.map((s, i) => ({ ...s, id: `col-${i}`, label: `Column ${i}` }));
  assert.deepEqual(renamed.map((s) => pipelineStageTone(s.id, renamed)), tones);
});

test("unknown and empty values resolve neutral on every axis, never a verdict", () => {
  for (const axis of AXES) {
    assert.equal(axis.resolve("wat"), "neutral", `${axis.name} guessed a tone for an unknown value`);
    assert.equal(axis.resolve(""), axis.name === "jobs.status" ? "active" : "neutral");
  }
  // The one deliberate exception, stated where it is easy to find: a job row with a
  // NULL status is a seeded/corpus job that IS live, not an unknown one.
  assert.equal(jobStatusTone(null), "active");
  assert.equal(jobStatusTone(undefined), "active");
  assert.equal(jobStatusTone("draft"), "neutral");
});

// ---- 3. the legend -----------------------------------------------------------

test("the legend is exactly the five reading states, in reading order", () => {
  assert.deepEqual([...STATUS_TONES], ["neutral", "active", "waiting", "done", "stopped"]);
});

test("every locale names all five tones, and the legend has a title", () => {
  for (const locale of LOCALES) {
    const tones = catalog(locale, "status", "tone");
    assertSameSet(Object.keys(tones), STATUS_TONES, `messages/${locale}.json status.tone`);
    for (const [k, v] of Object.entries(tones)) {
      assert.ok(typeof v === "string" && v.trim(), `messages/${locale}.json status.tone.${k} is empty`);
    }
    const title = catalog(locale, "status", "legend").title;
    assert.ok(typeof title === "string" && title.trim(), `messages/${locale}.json status.legend.title is missing`);
  }
});

test("StatusChip draws all five states, and `stopped` is not painted as an error", () => {
  const src = read("app", "_components", "StatusChip.tsx");
  const block = src.slice(src.indexOf("const TONE_RENDER"), src.indexOf("export function StatusChip"));
  for (const tone of STATUS_TONES) {
    assert.match(block, new RegExp(`\\b${tone}:\\s*\\{`), `StatusChip has no rendering for the "${tone}" state`);
  }
  // A closed job, a closed assignment and a revoked link are ordinary outcomes.
  // Painting them with Badge's `critical` tone would make the thread read as broken.
  assert.doesNotMatch(block, /stopped:\s*\{\s*tone:\s*"critical"/, "`stopped` must not render as an error");
  assert.match(block, /stopped:\s*\{[^}]*muted:\s*true/, "`stopped` recedes via Badge's muted treatment");
});
