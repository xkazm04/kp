// Guards against silent TS<->Python interview-rubric drift (idea-3eb43991).
//
// The scorecard rubrics live in ONE file — pipeline/jobfit/interview-rubrics.json
// — read directly by BOTH the Python scorer (automation.py) and this TS module
// (interview-rubric.ts), the same single-source pattern as archetypes.json. That
// makes data drift structurally hard, but "both read the JSON" was only a verbal
// convention: nothing stopped someone re-hardcoding the TS side, mis-coercing the
// anchor keys, or editing the JSON into a shape one renderer can't display.
//
// This test pins the TS half of the contract: the real interview-rubric.ts
// exports must equal the JSON exactly (anchor keys/labels, competency list/order
// per model) and keep the shape the InterviewTranscriptModal / compare grid
// depend on. The Python half is pinned independently by
// pipeline/jobfit/tests/test_interview_rubrics.py (automation.* == the same
// JSON). Pinning both sides to the one file makes TS == JSON == Python an
// enforced contract: drift on either side fails that language's CI lane, instead
// of the TS mirror silently rendering a stale scale.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The module under test imports the "@/*" alias, an extensionless TS file, and a
// JSON file without an import attribute — all three are how Next/tsc resolve, but
// none work under the bare `node --test` runner (it doesn't read tsconfig
// `paths`, auto-append .ts, or import JSON without `with { type: "json" }`).
// Install minimal module hooks so we can load the REAL module rather than a copy
// of its logic — a copy could never catch the module itself drifting. The hooks
// are scoped to this test file's process (node --test isolates files) and only
// touch "@/", extensionless-local, and .json specifiers.
const ROOT = new URL("../../", import.meta.url).href; // repo root (app/_lib/ -> ../../)
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if (spec.startsWith("@/")) spec = new URL(spec.slice(2), ROOT).href; // tsconfig "@/*"
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts"; // extensionless import, e.g. "@/app/_lib/archetypes"
    }
    return nextResolve(spec, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".json")) {
      // Wrap JSON as an ES module so the missing `type: json` attribute is moot.
      const source = "export default " + readFileSync(fileURLToPath(url), "utf8") + ";";
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// The shared source of truth, read straight off disk — independent of the module
// under test, so the "expected" side can't be tainted by the same import the
// module uses. This IS the file automation.py reads.
type RawCompetency = { competency: string; description: string; anchors?: Record<string, string> };
type RawRubrics = { ratingAnchors: Record<string, string>; rubrics: Record<string, RawCompetency[]> };
const readJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const SOURCE: RawRubrics = readJson("../../pipeline/jobfit/interview-rubrics.json");
const ARCHETYPES: { archetypes: Array<{ id: string; scoringModel: string }> } = readJson(
  "../../pipeline/jobfit/archetypes.json"
);

const {
  RATING_ANCHORS,
  INTERVIEW_RUBRIC,
  INTERVIEW_RUBRICS,
  INDUSTRY_AXES,
  industryAxesFor,
  RUBRIC_ANCHOR_LINE,
  rubricForArchetype,
  RUBRIC_CS,
  RATING_ANCHORS_CS,
  localizedRubric,
  rubricLabel,
} = await import("@/app/_lib/interview-rubric.ts");

// All competency objects across base rubrics AND industry axes — the canonical
// set the CS overlay + scoring contract are pinned against (P2-3).
const ALL_COMPETENCIES: { competency: string; anchors?: Record<string, string> }[] = [
  ...INTERVIEW_RUBRICS.experienced,
  ...INTERVIEW_RUBRICS.early_career,
  ...Object.values(INDUSTRY_AXES as Record<string, { competency: string }[]>).flat(),
];

// ---------------------------------------------------------------------------
// The TS exports ARE the JSON (no hand-written literal, no mis-coercion).
// ---------------------------------------------------------------------------

test("RATING_ANCHORS is the JSON's ratingAnchors, keyed by number", () => {
  const expected = Object.fromEntries(
    Object.entries(SOURCE.ratingAnchors).map(([k, v]) => [Number(k), v])
  );
  assert.deepEqual(RATING_ANCHORS, expected);
});

test("rating anchors cover exactly levels 1-5 with integer keys", () => {
  assert.deepEqual(
    Object.keys(RATING_ANCHORS).map(Number).sort((a, b) => a - b),
    [1, 2, 3, 4, 5]
  );
  for (const k of Object.keys(RATING_ANCHORS)) {
    assert.ok(Number.isInteger(Number(k)), `anchor key ${k} must be an integer`);
  }
});

test("INTERVIEW_RUBRICS is exactly the JSON's rubrics", () => {
  assert.deepEqual(INTERVIEW_RUBRICS, SOURCE.rubrics);
});

test("INTERVIEW_RUBRIC is the experienced rubric (the recruiter-compare default)", () => {
  // Identity, not a copy: the historical flat name aliases the experienced axes.
  assert.equal(INTERVIEW_RUBRIC, INTERVIEW_RUBRICS.experienced);
  assert.deepEqual(INTERVIEW_RUBRIC, SOURCE.rubrics.experienced);
});

// ---------------------------------------------------------------------------
// Competency list & order per scoring model match the JSON exactly — the axes
// every candidate of a cohort is compared on must stay identical and ordered.
// ---------------------------------------------------------------------------

test("every rubric's competency list and order match the JSON exactly", () => {
  assert.deepEqual(Object.keys(INTERVIEW_RUBRICS).sort(), Object.keys(SOURCE.rubrics).sort());
  for (const model of Object.keys(SOURCE.rubrics)) {
    assert.ok(INTERVIEW_RUBRICS[model], `TS is missing the '${model}' rubric`);
    assert.deepEqual(
      INTERVIEW_RUBRICS[model].map((c) => c.competency),
      SOURCE.rubrics[model].map((c) => c.competency),
      `'${model}' competency list/order drifted from the JSON`
    );
  }
});

// ---------------------------------------------------------------------------
// Shape the UI depends on — mirrors test_interview_rubrics.py so a JSON edit
// that would break a renderer fails in BOTH the TS and the Python CI lane.
// ---------------------------------------------------------------------------

test("every competency has a name and description", () => {
  for (const [model, rubric] of Object.entries(INTERVIEW_RUBRICS)) {
    assert.ok(rubric.length > 0, `${model} rubric is empty`);
    for (const c of rubric) {
      assert.ok(c.competency, `${model}: a competency is missing its name`);
      assert.ok(c.description, `${model}: '${c.competency}' is missing a description`);
    }
  }
});

test("early-career rubric is fully behaviorally anchored (BARS levels 1-5)", () => {
  const rubric = INTERVIEW_RUBRICS.early_career;
  assert.ok(rubric.length >= 6, "early-career rubric should cover the 6 potential constructs");
  for (const c of rubric) {
    const anchors = c.anchors;
    assert.ok(anchors, `early_career '${c.competency}' has no BARS anchors`);
    assert.deepEqual(
      Object.keys(anchors).sort(),
      ["1", "2", "3", "4", "5"],
      `early_career '${c.competency}' anchors must cover levels 1-5`
    );
    for (const [level, text] of Object.entries(anchors)) {
      assert.ok(String(text).trim(), `early_career '${c.competency}' anchor ${level} is empty`);
    }
  }
});

test("experienced rubric carries no per-level anchors (prompt stays byte-identical)", () => {
  for (const c of INTERVIEW_RUBRICS.experienced) {
    assert.ok(!("anchors" in c), `experienced '${c.competency}' unexpectedly carries BARS anchors`);
  }
});

// ---------------------------------------------------------------------------
// Archetype -> rubric selection lines up with the experienced/early-career
// split, registry-driven (mirrors automation.rubric_for_archetype).
// ---------------------------------------------------------------------------

test("rubricForArchetype selects early_career for early-career archetypes, experienced otherwise", () => {
  const earlyIds = ARCHETYPES.archetypes
    .filter((a) => a.scoringModel === "early_career")
    .map((a) => a.id);
  assert.ok(earlyIds.length > 0, "expected at least one early-career archetype in the registry");
  // With no role-family the result is EXACTLY the base rubric (deepEqual: the fn
  // returns a fresh array, so compare contents, not reference).
  for (const id of earlyIds) {
    assert.deepEqual(
      rubricForArchetype(id),
      INTERVIEW_RUBRICS.early_career,
      `early-career archetype '${id}' should select the early_career rubric`
    );
  }
  // Case / whitespace insensitive (mirrors normalizeArchetype).
  assert.deepEqual(rubricForArchetype(` ${earlyIds[0].toUpperCase()} `), INTERVIEW_RUBRICS.early_career);
  // Non-early, unknown, and null/undefined all fall back to experienced.
  assert.deepEqual(rubricForArchetype("bau"), INTERVIEW_RUBRICS.experienced);
  assert.deepEqual(rubricForArchetype("nonsense"), INTERVIEW_RUBRICS.experienced);
  assert.deepEqual(rubricForArchetype(null), INTERVIEW_RUBRICS.experienced);
  assert.deepEqual(rubricForArchetype(undefined), INTERVIEW_RUBRICS.experienced);
});

// ---------------------------------------------------------------------------
// P2-3 — industry axes append to the base rubric by role-family.
// ---------------------------------------------------------------------------

test("industry axes are description-only (no BARS) and keyed by known role-family slugs", () => {
  const KNOWN_FAMILIES = new Set([
    "software_engineering", "data_ai", "product_project", "healthcare_clinical",
    "life_sciences_research", "skilled_trades", "operations_logistics", "frontline_service",
    "sales_marketing", "finance_accounting", "legal_compliance", "hr_people",
    "education_academic", "creative_design", "customer_support", "general_professional",
  ]);
  const entries = Object.entries(INDUSTRY_AXES as Record<string, { competency: string; description: string; anchors?: unknown }[]>);
  assert.ok(entries.length > 0, "expected at least one industry mapped");
  for (const [family, axes] of entries) {
    assert.ok(KNOWN_FAMILIES.has(family), `industry axis family "${family}" is not a known role-family slug`);
    for (const a of axes) {
      assert.ok(a.competency && a.description, `axis in "${family}" needs competency + description`);
      assert.equal(a.anchors, undefined, `industry axis "${a.competency}" should be description-only`);
    }
  }
});

test("rubricForArchetype appends the role-family's industry axes after the base", () => {
  const base = rubricForArchetype("bau");
  const clinicalAxes = industryAxesFor("healthcare_clinical");
  assert.ok(clinicalAxes.length > 0, "expected clinical axes in the fixture");
  const withFamily = rubricForArchetype("bau", "healthcare_clinical");
  assert.equal(withFamily.length, base.length + clinicalAxes.length);
  assert.deepEqual(withFamily.slice(0, base.length), base);
  assert.deepEqual(withFamily.slice(base.length), clinicalAxes);
  // An unknown / blank family adds nothing.
  assert.deepEqual(rubricForArchetype("bau", "no_such_family"), base);
  assert.deepEqual(rubricForArchetype("bau", ""), base);
  assert.deepEqual(industryAxesFor(null), []);
});

// ---------------------------------------------------------------------------
// The prompt-facing scale line is derived from the anchors, not hand-written.
// ---------------------------------------------------------------------------

test("RUBRIC_ANCHOR_LINE is derived from RATING_ANCHORS", () => {
  const expected = Object.entries(RATING_ANCHORS)
    .map(([k, v]) => `${k} = ${v}`)
    .join(" · ");
  assert.equal(RUBRIC_ANCHOR_LINE, expected);
  assert.match(RUBRIC_ANCHOR_LINE, /\b1 = /);
  assert.match(RUBRIC_ANCHOR_LINE, /\b5 = /);
});

// ---------------------------------------------------------------------------
// PREP3 — the Czech display overlay must stay key-stable: every overlay key is
// a canonical competency, every canonical competency has an overlay, and
// localizedRubric keeps the canonical key while swapping display strings.
// ---------------------------------------------------------------------------

test("every RUBRIC_CS key maps to a canonical competency (no orphaned overlay)", () => {
  const canonical = new Set(ALL_COMPETENCIES.map((c) => c.competency));
  for (const key of Object.keys(RUBRIC_CS)) {
    assert.ok(canonical.has(key), `RUBRIC_CS key "${key}" is not a canonical competency`);
  }
});

test("every canonical competency has a cs overlay (no English leaking through cs)", () => {
  const all = ALL_COMPETENCIES;
  for (const c of all) {
    assert.ok(RUBRIC_CS[c.competency], `competency "${c.competency}" has no Czech overlay`);
    // Early-career competencies carry BARS anchors — their overlay must too.
    if (c.anchors) {
      const csAnchors = RUBRIC_CS[c.competency].anchors;
      assert.ok(csAnchors, `competency "${c.competency}" overlay is missing anchors`);
      assert.deepEqual(
        Object.keys(csAnchors ?? {}).sort(),
        Object.keys(c.anchors).sort(),
        `competency "${c.competency}" overlay anchors must cover the same levels`
      );
    }
  }
});

test("RATING_ANCHORS_CS covers the same levels as RATING_ANCHORS", () => {
  assert.deepEqual(
    Object.keys(RATING_ANCHORS_CS).map(Number).sort(),
    Object.keys(RATING_ANCHORS).map(Number).sort()
  );
});

test("localizedRubric keeps the canonical key, swaps display, and falls back for en", () => {
  const en = localizedRubric(INTERVIEW_RUBRICS.early_career, "en");
  const cs = localizedRubric(INTERVIEW_RUBRICS.early_career, "cs");
  for (let i = 0; i < en.length; i++) {
    // The canonical scoring key is identical across locales.
    assert.equal(en[i].competency, cs[i].competency);
    // en falls back to canonical strings; cs uses the overlay.
    assert.equal(en[i].label, en[i].competency);
    assert.equal(cs[i].label, RUBRIC_CS[cs[i].competency].label);
  }
  // rubricLabel degrades to the canonical key for an unmapped competency.
  assert.equal(rubricLabel("Some custom LLM competency", "cs"), "Some custom LLM competency");
});
