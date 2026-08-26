// bug-ui-scan 2026-07-09 (candidate-profile-job-matching #1): resolveCandidate must
// NOT assume software. An analysis whose extracted candidate carries no roleFamily
// (a non-tech CV, a degraded extraction, or an analysis saved before the taxonomy
// widened) must resolve to role-families.ts::DEFAULT_ROLE_FAMILY ("general_professional",
// "Never assume software") — NOT the old hardcoded "software_engineering" — and to an
// honest "unknown" seniority sentinel rather than a fabricated "medior". The prior
// fail-closed "unknown" ARCHETYPE path (so the Python ko_filter skips the seniority
// hard-gate for a class we can't classify) must stay intact.
// Drives the REAL db.ts against a throwaway SQLite file.
//   npm run test:unit
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
// Pre-load better-sqlite3 (and its internal CJS requires) BEFORE the resolve hook
// below is installed, so the hook never sees its extensionless `./lib/database`
// require — same reason the other real-db tests import it up front.
import "better-sqlite3";

// Same minimal loader hooks the other real-module db tests use so bare `node --test`
// can resolve the "@/*" alias, extensionless TS siblings, and JSON imports.
const ROOT = new URL("../../", import.meta.url).href; // repo root (app/_lib/ -> ../../)
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if (spec.startsWith("@/")) spec = new URL(spec.slice(2), ROOT).href;
    else if ((spec.startsWith("./") || spec.startsWith("../")) && context.parentURL) {
      spec = new URL(spec, context.parentURL).href;
    }
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && fs.existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts";
    }
    return nextResolve(spec, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".json")) {
      const source = "export default " + fs.readFileSync(fileURLToPath(url), "utf8") + ";";
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// A UNIQUE directory per run so a locked leftover SQLite file can never poison a
// later run (same rationale as erasure-analyses-scrub.test.ts).
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kp-resolve-candidate-"));
const TMP = path.join(TMP_DIR, "kp.sqlite");
process.env.KP_DB_PATH = TMP;
delete process.env.DATABASE_URL;

const { saveAnalysis } = await import("./db.ts");
const { resolveCandidate, candidateSignature } = await import("./match-candidate.ts");
const { DEFAULT_ROLE_FAMILY } = await import("./role-families.ts");

after(() => {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    /* file locked — the unique dir means a leftover can never poison a later run */
  }
});

function seedUnprofiledAnalysis(): string {
  // A non-tech CV extracted with NO roleFamily / currentSeniority and NO v2Profile.
  const { slug } = saveAnalysis({
    candidateLabel: `Nurse ${process.pid}`,
    jdSlug: null,
    score: 61,
    roleFamily: null,
    seniority: null,
    payload: {
      candidate: { skills: ["Patient care", "Triage"], name: "Nurse" },
      // no v2Profile -> archetype must fail closed to "unknown"
    },
  });
  return slug;
}

test("analysis with no stated role family resolves to general_professional, NOT software_engineering", () => {
  const slug = seedUnprofiledAnalysis();
  const resolved = resolveCandidate({ analysisSlug: slug });
  assert.ok("candidate" in resolved, "expected a resolved candidate, not an error");
  const c = resolved.candidate;

  // The core of the finding: never assume software for an unclassified family.
  assert.equal(c.roleFamily, "general_professional");
  assert.equal(c.roleFamily, DEFAULT_ROLE_FAMILY, "must route through the single-source default");
  assert.notEqual(c.roleFamily, "software_engineering");

  // Seniority is an honest sentinel, not a fabricated "medior".
  assert.equal(c.seniority, "unknown");
  assert.notEqual(c.seniority, "medior");
});

test("the un-profiled path STILL yields the fail-closed 'unknown' archetype (must not regress)", () => {
  const slug = seedUnprofiledAnalysis();
  const resolved = resolveCandidate({ analysisSlug: slug });
  assert.ok("candidate" in resolved);
  // Unchanged by this fix: the archetype stays "unknown" so the Python ko_filter
  // skips the seniority hard-gate for a class it cannot classify.
  assert.equal(resolved.candidate.archetype, "unknown");
});

test("a stated role family / seniority is preserved (defaults only fill the gaps)", () => {
  const { slug } = saveAnalysis({
    candidateLabel: `Clinician ${process.pid}`,
    jdSlug: null,
    score: 70,
    roleFamily: "healthcare_clinical",
    seniority: "senior",
    payload: {
      candidate: { skills: ["ICU"], roleFamily: "healthcare_clinical", currentSeniority: "senior" },
      v2Profile: { archetype: "bau" },
    },
  });
  const resolved = resolveCandidate({ analysisSlug: slug });
  assert.ok("candidate" in resolved);
  assert.equal(resolved.candidate.roleFamily, "healthcare_clinical");
  assert.equal(resolved.candidate.seniority, "senior");
  assert.equal(resolved.candidate.archetype, "bau");
});

// candidate-profile-job-matching #3(c): domainDistance feeds the career-switcher
// reasoning prompt (match_reasoning.py), so it MUST ride the cache signature —
// otherwise two switchers differing only in bridge distance collide on the hash and
// the first verdict is served to the second.
test("candidateSignature separates two career-switchers that differ ONLY in domainDistance", () => {
  const base = { skills: ["Python"], archetype: "career_switcher", transferableSkills: ["Delivery"] };
  const near = candidateSignature({ ...base, domainDistance: "adjacent" });
  const far = candidateSignature({ ...base, domainDistance: "far" });
  assert.notEqual(near, far, "a change in domainDistance must change the cache signature");
  // And the field is actually reflected in the signature payload (not silently dropped).
  assert.ok(near.includes("adjacent"));
  assert.ok(far.includes("far"));
  // Absent domainDistance is stable/normalized (null), so a repeat call collides by design.
  assert.equal(candidateSignature(base), candidateSignature({ ...base }));
});
