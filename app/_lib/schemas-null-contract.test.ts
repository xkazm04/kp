// Pins the exclude_none contract that codegen depends on (idea-1af1e54c).
//
// codegen.py emits `.nullish()` for every nullable Pydantic field so the
// generated Zod schema accepts a field two ways: ABSENT (the Python serializer
// passed `model_dump(exclude_none=True)`) or present as JSON `null` (it did
// not). Before this, codegen emitted `.optional()`, which rejects `null`, so
// the schema was only correct as long as every serializer remembered
// `exclude_none=True` — an invisible cross-language coupling. This test fails if
// codegen ever regresses to `.optional()`, turning that silent contract loud.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { analysisResultSchema } from "./schemas.generated.ts";

// The required core of an AnalysisResult — every field that is NOT nullable in
// pipeline/jobfit/models.py, so it is always present on the wire regardless of
// exclude_none. A fresh object per call so a test can mutate one field.
function requiredCore() {
  return {
    candidate: {
      rawText: "Senior engineer with 8 years building payment systems.",
      yearsExperience: 8,
      currentSeniority: "senior",
      roleFamily: "software_engineering",
      skills: ["python", "typescript"],
      educationLevel: "bachelor",
      languages: ["english"],
      traits: ["pragmatic"],
      evidence: ["Led migration to event-driven architecture."],
    },
    score: { total: 82, experience: 18, skills: 20, roleSeniority: 16, education: 14, traits: 14 },
    salary: {
      currency: "USD",
      period: "year",
      minimum: 150000,
      maximum: 190000,
      midpoint: 170000,
      confidence: "medium",
      rationale: ["Anchored to senior backend band."],
    },
    strengths: ["Deep payments domain knowledge."],
    gaps: ["No formal management experience."],
    recommendations: ["Highlight system-design ownership."],
    explanation: "Strong senior backend match.",
    sanityChecks: [],
  };
}

// The fields whose Python type allows None — codegen emits these as
// `.nullish()`. Listed here so the "all present as null" case mirrors a
// `model_dump(by_alias=True)` that forgot `exclude_none=True`.
const NULLABLE_TOP_LEVEL = [
  "jobFit",
  "metadata",
  "marketEvidence",
  "extractionQuality",
  "extractionComparison",
  "companyContext",
  "evidenceTrace",
  "interviewKit",
  "keywordCoverage",
  "v2Profile",
] as const;

test("accepts the exclude_none=True wire shape (nullable fields absent)", () => {
  // This is what service.py emits today: model_dump(exclude_none=True) drops
  // every None-valued field, so the optional keys never appear.
  const result = analysisResultSchema.safeParse(requiredCore());
  assert.ok(result.success, result.success ? "" : JSON.stringify(result.error.issues, null, 2));
});

test("accepts the exclude_none=False wire shape (nullable fields present as null)", () => {
  // This is what a serializer that FORGETS exclude_none emits: every Optional
  // field present with a JSON null. The pre-fix `.optional()` schema rejected
  // this; `.nullish()` must accept it.
  const nullBearing: Record<string, unknown> = requiredCore();
  for (const key of NULLABLE_TOP_LEVEL) nullBearing[key] = null;
  const result = analysisResultSchema.safeParse(nullBearing);
  assert.ok(result.success, result.success ? "" : JSON.stringify(result.error.issues, null, 2));
});

test("tolerates null on nested nullable fields, not just top-level ones", () => {
  // Nullable fields nest: candidate.name, metadata.model,
  // metadata.deterministicEvidence(.detectedSeniority/.detectedCompanyType),
  // marketEvidence.suggestedMinimum/Maximum. A non-exclude_none dump emits all
  // of these as null; the generated schema must accept the whole tree.
  const payload = {
    ...requiredCore(),
    candidate: { ...requiredCore().candidate, name: null },
    metadata: {
      analysisEngine: "gemini",
      textExtractor: "gemini",
      model: null,
      parsingNotes: [],
      groundingSources: [],
      deterministicEvidence: {
        detectedRoleFamily: "software_engineering",
        detectedSeniority: null,
        anchorBand: [150000, 190000],
        detectedSignals: [],
        detectedSkills: [],
        detectedCompanyType: null,
        detectedCompanyModifiers: [],
      },
    },
    marketEvidence: {
      summary: "Thin market data.",
      suggestedMinimum: null,
      suggestedMaximum: null,
      confidence: "low",
      sources: [],
      notes: [],
    },
  };
  const result = analysisResultSchema.safeParse(payload);
  assert.ok(result.success, result.success ? "" : JSON.stringify(result.error.issues, null, 2));
});

test("still rejects a genuinely missing REQUIRED field (the schema is not accept-anything)", () => {
  const broken: Record<string, unknown> = requiredCore();
  delete (broken.candidate as Record<string, unknown>).rawText;
  assert.equal(analysisResultSchema.safeParse(broken).success, false);
});

test("still rejects null on a REQUIRED field (.nullish() only widened nullable ones)", () => {
  // rawText is a non-nullable str in models.py, so codegen emits a bare
  // z.string(). null must be rejected — proving .nullish() did not leak onto
  // required fields and quietly weaken the whole contract.
  const broken = { ...requiredCore(), candidate: { ...requiredCore().candidate, rawText: null } };
  assert.equal(analysisResultSchema.safeParse(broken).success, false);
});
