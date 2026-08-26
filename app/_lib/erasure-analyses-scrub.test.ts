// GDPR Art. 17 regression (bug-ui-scan 2026-06-20 critical #4): anonymizeEntry must
// also scrub the saved `analyses` rows, not just the pipeline entry + profile. The
// analyses table holds the FULL CV payload (rawText, name, email, verbatim evidence)
// and has no FK back to the entry, so the scrub matches on candidate_label. Before
// the fix an erasure left that CV fully readable in History / /api/analyses/[slug].
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

// A UNIQUE directory per run, not a `${process.pid}` filename. PIDs are reused, and a
// locked SQLite file survives the `after()` sweep (tmpdir accumulated 176 of these), so a
// pid-derived path could open a stale, already-populated database and fail this test for
// reasons that have nothing to do with erasure. Observed ~1 run in 8.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kp-erasure-scrub-"));
const TMP = path.join(TMP_DIR, "kp.sqlite");
process.env.KP_DB_PATH = TMP;
delete process.env.DATABASE_URL;

const { createPipelineEntry, anonymizeEntry, saveAnalysis, loadAnalysis } = await import("./db.ts");

after(() => {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    /* file locked — the unique dir means a leftover can never poison a later run */
  }
});

test("erasure scrubs PII from the candidate's saved analyses (matched by label)", () => {
  const label = `Jane Doe ${process.pid}`;
  const { entry } = createPipelineEntry({
    candidateId: `c-erase-${process.pid}`,
    candidateLabel: label,
    jobId: `job-erase-${process.pid}`,
    jobTitle: "Backend Engineer",
    stage: "Screened",
  });

  const { slug } = saveAnalysis({
    candidateLabel: label,
    jdSlug: null,
    score: 82,
    roleFamily: "backend",
    seniority: "mid",
    payload: {
      candidate: { name: "Jane Doe", email: "jane@example.com", phone: "+420123456789" },
      rawText: "Jane Doe — full CV body with home address and everything.",
      evidence: ["Jane led the payments rewrite", "contactable at jane@example.com"],
      // Verbatim CV quotes the provenance dossier re-exports — must NOT survive erasure.
      evidenceTrace: {
        experience: ["Senior Engineer at Acme Corp 2019-2023, owned billing"],
        skills: ["Jane shipped the Python settlement service"],
        salary: ["currently on 1,200,000 CZK at Acme"],
      },
      // bug-scan 2026-08-21 (lib-compliance): the SAME uploaded CV text is stored a
      // second and third time under extractionComparison (pipeline.py populates it on
      // EVERY run), and the deterministic explanation/interview-kit builders interpolate
      // the candidate's name. Only `rawText` was scrubbed, so an erased candidate's whole
      // CV — name, email, phone — stayed readable in History / /api/analyses/[slug].
      extractionComparison: {
        pypdfText: "Jane Doe\njane@example.com\n+420123456789\nExtracted CV text, pypdf pass.",
        geminiText: "Jane Doe\njane@example.com\n+420123456789\nExtracted CV text, gemini pass.",
      },
      explanation: "Jane Doe was assessed as senior in backend. Score 82/100.",
      interviewKit: {
        summary: "Jane Doe: 9 mock questions tied to 6 evidence gaps.",
        questions: [{ bucket: "technical", question: "Walk Jane through the Acme billing rewrite.", evidenceGap: "" }],
      },
      score: 82, // non-PII recruitment signal must survive
    },
  });

  // Sanity: the PII is present before erasure.
  const before = loadAnalysis(slug);
  assert.ok(before, "analysis should exist before erasure");
  assert.match(JSON.stringify(before!.payload), /jane@example\.com/);

  const result = anonymizeEntry(entry.id, "erasure");
  assert.ok(result, "anonymizeEntry should return the entry");

  const after = loadAnalysis(slug);
  assert.ok(after, "analysis row still exists (retained, scrubbed)");
  const flat = JSON.stringify(after!.payload);
  // No directly-identifying PII may survive anywhere in the payload.
  assert.doesNotMatch(flat, /jane@example\.com/i, "email scrubbed");
  assert.doesNotMatch(flat, /\+420123456789/, "phone scrubbed");
  assert.doesNotMatch(flat, /full CV body/i, "rawText scrubbed");
  assert.deepEqual((after!.payload as { evidence: unknown[] }).evidence, [], "evidence emptied");
  // GDPR Art.17: verbatim CV quotes under evidenceTrace.* must not survive either.
  assert.doesNotMatch(flat, /Acme Corp/i, "evidenceTrace.experience quotes scrubbed");
  assert.doesNotMatch(flat, /settlement service/i, "evidenceTrace.skills quotes scrubbed");
  assert.doesNotMatch(flat, /1,200,000/, "evidenceTrace.salary quotes scrubbed");
  assert.deepEqual(
    (after!.payload as { evidenceTrace: Record<string, unknown[]> }).evidenceTrace.experience,
    [],
    "evidenceTrace.experience emptied",
  );
  // The re-extracted copies of the same CV must go too — scrubbing only `rawText`
  // left the identical text (name + email + phone) under extractionComparison.
  assert.doesNotMatch(flat, /Extracted CV text/i, "extractionComparison.{pypdf,gemini}Text scrubbed");
  // Prose the deterministic builders stamp the candidate's NAME into.
  assert.doesNotMatch(flat, /assessed as senior/i, "explanation scrubbed");
  assert.doesNotMatch(flat, /mock questions/i, "interviewKit.summary scrubbed");
  assert.doesNotMatch(flat, /billing rewrite/i, "interviewKit question text scrubbed");
  assert.doesNotMatch(flat, /Jane Doe/i, "no copy of the name survives anywhere in the payload");

  // Non-identifying recruitment signal is retained for rediscovery.
  assert.equal((after!.payload as { score: number }).score, 82, "score retained");
  // The stored label is masked, not the full name.
  assert.doesNotMatch(after!.row.candidate_label, /Jane Doe/);
});
