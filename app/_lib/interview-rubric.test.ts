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
  flagOffRubricRatings,
  flagOffRubricRatingsWithKeys,
  rubricCompetencyKeys,
  rubricVersionHash,
  rubricCoverage,
  isDisclosedGap,
  RUBRIC_COVERAGE_GAPS,
  RUBRIC_COVERAGE_DISCLOSED_GAPS,
} = await import("@/app/_lib/interview-rubric.ts");

// The canonical role-family vocabulary. Imported from the repo's TS single source,
// which role-families.test.ts pins by set equality to data/taxonomy.json —
// deliberately NOT re-derived from Object.keys(INDUSTRY_AXES), since "has industry
// axes" vs "is a real family" is exactly the conflation under test here.
const { ROLE_FAMILY_SLUGS } = await import("@/app/_lib/role-families.ts");

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

// ---------------------------------------------------------------------------
// Off-rubric flagging — the scorecard POST validates client competencies against
// the entry's CURRENT rubric, KEEPING but flagging any that fall outside it (the
// same concept CompareInterviews surfaces). Never rejects — records outlive
// rubric revisions by design.
// ---------------------------------------------------------------------------

test("rubricCompetencyKeys: lowercased key set of a rubric's axes", () => {
  const rubric = INTERVIEW_RUBRICS.experienced;
  const keys = rubricCompetencyKeys(rubric);
  assert.equal(keys.size, rubric.length);
  for (const c of rubric) assert.ok(keys.has(c.competency.toLowerCase()));
});

test("flagOffRubricRatings: a competency outside the rubric is kept but flagged; on-rubric ones stay unflagged", () => {
  const rubric = INTERVIEW_RUBRICS.experienced; // Technical depth, Problem-solving, …
  const ratings = [
    { competency: "Technical depth", rating: 4, evidence: "quote" },
    { competency: "Legacy axis v1", rating: 5 }, // renamed/removed axis — off-rubric
  ];
  const out = flagOffRubricRatings(ratings, rubric);
  assert.equal(out.length, 2, "no rating is dropped");
  assert.equal(out[0].offRubric, undefined, "on-rubric rating carries no flag");
  assert.equal(out[0].evidence, "quote", "on-rubric rating is returned untouched");
  assert.equal(out[1].offRubric, true, "off-rubric rating is kept AND flagged");
  assert.equal(out[1].rating, 5, "off-rubric rating value preserved");
});

test("flagOffRubricRatings: matching is case-insensitive, like the compare grid's join", () => {
  const out = flagOffRubricRatings(
    [{ competency: "TECHNICAL depth", rating: 3 }],
    INTERVIEW_RUBRICS.experienced
  );
  assert.equal(out[0].offRubric, undefined, "a case-variant of a rubric axis is on-rubric");
});

test("flagOffRubricRatings: an industry axis is on-rubric when the role-family adds it", () => {
  const clinical = rubricForArchetype("bau", "healthcare_clinical");
  const axis = industryAxesFor("healthcare_clinical")[0].competency;
  // Against the base-only rubric the clinical axis is off-rubric...
  assert.equal(flagOffRubricRatings([{ competency: axis, rating: 4 }], rubricForArchetype("bau"))[0].offRubric, true);
  // ...but on-rubric once the role-family appends it (the entry-specific rubric).
  assert.equal(flagOffRubricRatings([{ competency: axis, rating: 4 }], clinical)[0].offRubric, undefined);
});

// ---------------------------------------------------------------------------
// Direction 2 — scorecards remember their rubric. rubricVersionHash stamps a
// stable content hash of the resolved slice at write time; flagOffRubricRatingsWithKeys
// re-evaluates off-rubric against the STORED scale where present, so a rubric
// revision can't retroactively re-flag a once-valid axis. The exact hex literals
// below are the CROSS-SIDE PARITY ANCHOR: test_interview_rubrics.py asserts the same
// values for the same rubric slices, so TS == Python is enforced in both CI lanes.
// ---------------------------------------------------------------------------

test("rubricVersionHash: stable, content-sensitive, and byte-identical to the Python stamp", () => {
  // These literals MUST equal automation.rubric_version_hash(...) for the same slice
  // (pinned in test_interview_rubrics.py). Changing the rubric JSON changes them —
  // update both sides together.
  assert.equal(rubricVersionHash(rubricForArchetype("bau")), "c5303546821999e1", "experienced rubric version");
  assert.equal(rubricVersionHash(rubricForArchetype("student")), "981e0b005f004e88", "early_career rubric version");
  assert.equal(
    rubricVersionHash(rubricForArchetype("bau", "healthcare_clinical")),
    "706059338ba7503e",
    "experienced + clinical axes rubric version"
  );
  // Deterministic (a re-hash of the same slice is identical) and 16 lowercase hex.
  assert.equal(rubricVersionHash(rubricForArchetype("bau")), rubricVersionHash(rubricForArchetype("bau")));
  assert.match(rubricVersionHash(rubricForArchetype("bau")), /^[0-9a-f]{16}$/);
  // A different scale hashes differently: appending industry axes MUST move it.
  assert.notEqual(rubricVersionHash(rubricForArchetype("bau")), rubricVersionHash(rubricForArchetype("bau", "healthcare_clinical")));
});

test("flagOffRubricRatingsWithKeys: prefers the stored scale; legacy rows fall back unchanged", () => {
  const current = rubricForArchetype("bau"); // Technical depth, Problem-solving, …
  const rating = [{ competency: "Legacy axis v1", rating: 5 }];

  // Stored keys INCLUDE the axis → on-rubric against the historical scale, even
  // though the current rubric no longer has it.
  const withStored = flagOffRubricRatingsWithKeys(rating, ["Legacy axis v1", "Technical depth"], current);
  assert.equal(withStored[0].offRubric, undefined, "an axis present in the stored keys stays on-rubric");

  // No stored keys (legacy row) → falls back to the CURRENT rubric, identical to
  // flagOffRubricRatings — the axis is off-rubric.
  const legacy = flagOffRubricRatingsWithKeys(rating, null, current);
  assert.equal(legacy[0].offRubric, true, "a legacy unversioned row behaves exactly as today");
  assert.deepEqual(legacy, flagOffRubricRatings(rating, current), "legacy path == the current-rubric flag");
  assert.deepEqual(flagOffRubricRatingsWithKeys(rating, [], current), flagOffRubricRatings(rating, current), "empty stored keys == legacy");

  // Case-insensitive match against the stored keys, like the compare grid's join.
  assert.equal(flagOffRubricRatingsWithKeys([{ competency: "technical DEPTH", rating: 3 }], ["Technical depth"], current)[0].offRubric, undefined);
});

// ---------------------------------------------------------------------------
// rubricCoverage — the honest report on WHY a rubric has no industry axes.
//
// The defect: industryAxesFor returns `[]` for an absent family, a canonical
// family with none defined, AND an unrecognized string alike; that empty list
// concatenates into the rubric leaving no trace, so an interviewer could score a
// candidate on a generic scorecard believing it was role-tuned.
//
// The correction underneath the correction: only 6 of the 16 canonical families
// have industry axes, BY DESIGN (they are the care/trades/frontline arc). For the
// other 10 the base rubric IS the intended rubric, so disclosing them would fire
// on the majority of interviews and turn the notice into wallpaper. These tests
// therefore pin what must stay SILENT as hard as what must speak.
// ---------------------------------------------------------------------------

// The three cohorts, all DERIVED — never hand-listed. role-families.test.ts
// separately pins ROLE_FAMILY_SLUGS to data/taxonomy.json::role_families, so this
// partition is anchored to the canonical taxonomy, not to a copy of it.
const CANONICAL = [...ROLE_FAMILY_SLUGS] as string[];
const AXIS_BEARING = CANONICAL.filter((f) => f in INDUSTRY_AXES);
const BY_DESIGN_BARE = CANONICAL.filter((f) => !(f in INDUSTRY_AXES));

test("the coverage cohorts are the shape the disclosure policy assumes (6 / 10 / 16)", () => {
  // Not decoration: if a future edit gave every family axes, or emptied the axis
  // block, the silence/disclosure tests below would still pass vacuously.
  assert.equal(CANONICAL.length, 16, "the canonical taxonomy is 16 role families");
  assert.equal(AXIS_BEARING.length, 6, "exactly 6 families carry industry axes");
  assert.equal(BY_DESIGN_BARE.length, 10, "the other 10 are bare BY DESIGN, not by omission");
  // Every industryAxes key must BE a canonical family — an axis block for a slug
  // outside the taxonomy would be unreachable, and would mean the coverage
  // partition is lying about what it covers.
  const orphans = Object.keys(INDUSTRY_AXES).filter((f) => !CANONICAL.includes(f));
  assert.deepEqual(orphans, [], `interview-rubrics.json defines industryAxes for non-canonical families: ${orphans.join(", ")}`);
});

test("case 1 — an ABSENT role family is `no_family`, disclosed, and never invented", () => {
  for (const raw of [null, undefined, "", "   "]) {
    const cov = rubricCoverage(raw);
    assert.equal(cov.gap, "no_family", `${JSON.stringify(raw)} must report no_family`);
    assert.equal(cov.roleFamily, null, "an absent family stays null — never defaulted to a guess");
    assert.deepEqual(cov.axisKeys, [], "no axes may be claimed when the family is unknown");
    assert.equal(isDisclosedGap(cov.gap), true, "no_family is the case that genuinely matters — it MUST speak");
  }
});

test("case 2 — a canonical family with no axes is `family_no_axes` and stays SILENT", () => {
  assert.ok(BY_DESIGN_BARE.length > 0, "fixture drift: no by-design-bare families left to check");
  for (const family of BY_DESIGN_BARE) {
    const cov = rubricCoverage(family);
    assert.equal(cov.gap, "family_no_axes", `${family} is canonical with no axes — that is the designed state`);
    assert.equal(cov.roleFamily, family, "the entry's OWN family is reported back, verbatim");
    assert.deepEqual(cov.axisKeys, []);
    assert.equal(
      isDisclosedGap(cov.gap),
      false,
      `${family} must render NOTHING — the base rubric is the intended rubric here, and a notice ` +
        `on 10 of 16 families is wallpaper that costs no_family its signal value.`
    );
  }
  // The families a recruiter meets most often are in this cohort. Spot-check the
  // ones named in review so an inversion cannot hide behind the derived list.
  for (const family of ["software_engineering", "data_ai", "finance_accounting", "legal_compliance"]) {
    assert.ok(BY_DESIGN_BARE.includes(family), `fixture drift: ${family} is no longer by-design bare`);
    assert.equal(isDisclosedGap(rubricCoverage(family).gap), false, `${family} must stay silent`);
  }
});

test("case 3 — a family outside the canonical taxonomy is `family_unrecognized` and IS disclosed", () => {
  for (const raw of ["not_a_real_family", "engineering_backend", "Healthcare Clinical"]) {
    assert.ok(!CANONICAL.includes(raw), `fixture drift: ${raw} is now canonical`);
    const cov = rubricCoverage(raw);
    assert.equal(cov.gap, "family_unrecognized", `${raw} is not in the taxonomy — a real data anomaly`);
    assert.equal(cov.roleFamily, raw, "the anomalous value is echoed back, NOT coerced onto a real family");
    assert.deepEqual(cov.axisKeys, []);
    assert.equal(isDisclosedGap(cov.gap), true);
  }
});

test("axis-bearing families report no gap and list the axes actually applied", () => {
  for (const family of AXIS_BEARING) {
    const axes = (INDUSTRY_AXES as Record<string, { competency: string }[]>)[family];
    const cov = rubricCoverage(family);
    assert.equal(cov.gap, null, `${family} has axes, so there is nothing to disclose`);
    assert.equal(cov.roleFamily, family);
    assert.deepEqual(cov.axisKeys, axes.map((a) => a.competency), `${family} axis keys must be the real ones`);
    // The reported keys are exactly the axes the resolved rubric gained — the cue
    // can never overstate coverage relative to what a candidate is scored on.
    const base = rubricForArchetype("bau");
    const withFamily = rubricForArchetype("bau", family);
    assert.deepEqual(withFamily.slice(base.length).map((c) => c.competency), cov.axisKeys);
  }
  // Whitespace is trimmed, not treated as a different family.
  assert.deepEqual(rubricCoverage("  " + AXIS_BEARING[0] + "  "), rubricCoverage(AXIS_BEARING[0]));
});

test("rubricCoverage never fabricates: a gap always means ZERO axis keys", () => {
  for (const raw of [null, "", ...CANONICAL, "not_a_real_family"]) {
    const cov = rubricCoverage(raw);
    assert.equal(
      cov.gap === null,
      cov.axisKeys.length > 0,
      `coverage for ${JSON.stringify(raw)} claims axes it does not have (or hides ones it does)`
    );
    if (cov.gap !== null) assert.ok(RUBRIC_COVERAGE_GAPS.includes(cov.gap), "gap must be a declared reason");
  }
});

test("the disclosed-gap list is a strict subset of the gap list, and excludes family_no_axes", () => {
  // RUBRIC_COVERAGE_DISCLOSED_GAPS drives BOTH the render gate (isDisclosedGap) and
  // the message catalog (rubric-coverage-catalog.test.ts). Pinning it here is what
  // makes case 2's silence structural: a gap absent from this tuple has no string
  // to render even if a future edit slipped past the component's gate.
  for (const gap of RUBRIC_COVERAGE_DISCLOSED_GAPS) {
    assert.ok(RUBRIC_COVERAGE_GAPS.includes(gap), `${gap} is disclosed but is not a declared gap`);
  }
  assert.ok(
    !(RUBRIC_COVERAGE_DISCLOSED_GAPS as readonly string[]).includes("family_no_axes"),
    "family_no_axes is the designed state for 10 of 16 families — disclosing it is the over-correction this split fixes"
  );
  assert.deepEqual([...RUBRIC_COVERAGE_DISCLOSED_GAPS].sort(), ["family_unrecognized", "no_family"]);
  assert.equal(isDisclosedGap(null), false, "applied coverage renders nothing");
});

test("REGRESSION: adding coverage reporting left every resolved rubric byte-identical", () => {
  // The normal path must be untouched. For every archetype x every family (canonical,
  // unrecognized, and absent), the resolved rubric is still exactly
  // base ++ industryAxesFor(family) — and its version hash is unchanged, which is
  // the byte-level check (rubricVersionHash covers competency + description + BARS).
  const families = [null, undefined, "", "not_a_real_family", ...CANONICAL];
  for (const archetype of ARCHETYPES.archetypes.map((a) => a.id)) {
    for (const family of families) {
      const resolved = rubricForArchetype(archetype, family);
      assert.deepEqual(
        resolved,
        [...rubricForArchetype(archetype), ...industryAxesFor(family)],
        `${archetype} x ${String(family)} must still be base ++ industry axes`
      );
      // A gap in coverage means the hash equals the family-less rubric's hash;
      // no gap means it differs. Coverage reporting changes neither.
      const cov = rubricCoverage(family);
      const bareHash = rubricVersionHash(rubricForArchetype(archetype));
      const hash = rubricVersionHash(resolved);
      if (cov.gap) assert.equal(hash, bareHash, `${archetype} x ${String(family)}: a gap must not alter the scale`);
      else assert.notEqual(hash, bareHash, `${archetype} x ${String(family)}: applied axes must move the scale`);
    }
  }
});
