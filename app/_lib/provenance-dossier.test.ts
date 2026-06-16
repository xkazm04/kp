import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

// provenance-dossier.ts imports its extensionless sibling ./sanity-checks (a VALUE
// import) — how Next/tsc resolve, but not bare `node --test`. Same minimal resolve
// hook the other real-module tests use (offers-store/schedule-store).
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if ((spec.startsWith("./") || spec.startsWith("../")) && context.parentURL) {
      spec = new URL(spec, context.parentURL).href;
    }
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && fs.existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts";
    }
    return nextResolve(spec, context);
  },
});

const { buildProvenanceDossier } = await import("./provenance-dossier.ts");

// A minimal but representative analysis payload (only the fields the dossier reads).
const full = {
  candidate: { name: "Jane Doe", roleFamily: "software_engineering", currentSeniority: "Senior", yearsExperience: 8 },
  score: { total: 78, experience: 80, skills: 75, roleSeniority: 82, education: 70, traits: 65 },
  explanation: "Strong backend match with a thin frontend record.",
  sanityChecks: ["Score total matches its breakdown", "Salary range needs manual review"],
  evidenceTrace: {
    experience: ["Led the payments team for 3 years"],
    skills: ["Built REST APIs in Python/Flask"],
    seniority: [],
    education: ["BSc Computer Science"],
    salary: [],
  },
  jobFit: {
    score: 76,
    summary: "Good fit, validate frontend depth.",
    matchingSkills: ["Python", "SQL"],
    missingSkills: ["React"],
    recruiterRiskFlags: ["Frontend evidence is thin"],
    mustProveEvidence: ["Owned a production React feature"],
  },
  softSignals: {
    strengths: [
      { key: "ownership", kind: "strength", label: "High ownership", detail: "Led a team end-to-end", evidence: ["Led the payments team"], confidence: 0.8, source: "cv", needsConfirmation: true, suggestedProbe: "" },
    ],
    antipatterns: [],
    summary: "",
  },
} as unknown as Parameters<typeof buildProvenanceDossier>[0];

test("dossier includes the name, every component score, and the evidence quote", () => {
  const md = buildProvenanceDossier(full, { savedAt: "2026-06-13" });
  assert.match(md, /# Provenance dossier — Jane Doe/);
  assert.match(md, /Total score: 78\/100/);
  assert.match(md, /Experience — 80\/100/);
  assert.match(md, /Skills — 75\/100/);
  assert.match(md, /Led the payments team for 3 years/); // the experience evidence quote
  assert.match(md, /Built REST APIs in Python\/Flask/); // the skills evidence quote
});

test("dossier splits the sanity ledger into warnings vs passed", () => {
  const md = buildProvenanceDossier(full);
  assert.match(md, /Warnings \(1\)/);
  assert.match(md, /Salary range needs manual review/);
  assert.match(md, /Passed \(1\)/);
  assert.match(md, /Score total matches its breakdown/);
});

test("dossier surfaces job-fit risk flags and soft-signal strengths", () => {
  const md = buildProvenanceDossier(full);
  assert.match(md, /Risk flags/);
  assert.match(md, /Frontend evidence is thin/);
  assert.match(md, /High ownership/);
  assert.match(md, /confidence 80%/);
});

test("a dimension with no evidence says so rather than omitting the score", () => {
  const md = buildProvenanceDossier(full);
  assert.match(md, /Seniority — 82\/100/);
  assert.match(md, /No CV evidence captured for this dimension/);
});

test("degrades gracefully on a sparse payload (no throw, name fallback)", () => {
  const sparse = { score: { total: 50 } } as unknown as Parameters<typeof buildProvenanceDossier>[0];
  const md = buildProvenanceDossier(sparse, { candidateLabel: "Anon Applicant" });
  assert.match(md, /# Provenance dossier — Anon Applicant/);
  assert.match(md, /Total score: 50\/100/);
  assert.match(md, /Trust ledger/);
});
