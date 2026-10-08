// The language chain end to end (council robustness-4): a need → runJdBuild (the design
// step stubbed, so nothing spawns) → ingestStructuredJob → buildApplyScript. The model
// ALWAYS proposes English here; the question is whether the applicant is asked for it.
// A ko_lang step ends an application automatically (ADR 0019), so "stated" must mean
// stated. unit-db.ts must be the first project import.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { runJdBuild } from "./jd-build-run.ts";
import { insertAnalyzingJd, loadJd, getJob } from "./db/jobs.ts";
import { jdJobId } from "./jd-limits.ts";
import { buildApplyScript } from "./apply.ts";
import { readRoleTrace, parseArtifacts } from "../features/library/jds/jdsLedgerArtifacts.ts";

after(() => cleanupUnitDb());

const OPTIONS = { description: true, marketResearch: false, caseDesign: false };
const steps = (languages: string[], title: string) => ({
  analyze: async () => ({ analysis: {}, snapshot: null }) as never,
  role: async () =>
    ({
      role: { title, seniority: "senior", responsibilities: ["Own the ingest pipeline"], mustHaves: ["TypeScript"], niceToHaves: [], languages },
      case: {},
      source: "claude",
      perStepSources: { role: "claude" },
      fallbackReason: {},
    }) as never,
});
// An echo translator: the step prompt carries the language list the applicant is asked about.
const t = ((key: string, vars?: Record<string, unknown>) => `${key}${vars ? ` ${JSON.stringify(vars)}` : ""}`) as never;

let seq = 0;
async function build(needText: string, modelLanguages: string[]) {
  // A distinct title per build: insertJob dedups on title + body, and two roles with no
  // languages would otherwise be one job.
  const title = `Platform Engineer ${++seq}`;
  const { slug } = insertAnalyzingJd({ title, options: OPTIONS });
  await runJdBuild({ title, needText, jdSlug: slug, options: OPTIONS, lang: "cs" }, undefined, undefined, undefined, steps(modelLanguages, title));
  const job = getJob(jdJobId(slug));
  assert.ok(job, "the build ingests a matchable job");
  const trace = readRoleTrace(parseArtifacts(loadJd(slug)?.analysis_json));
  return { ko: buildApplyScript(job, t).filter((s) => s.id === "ko_lang"), trace };
}

test("a Czech need that states English gives a ko_lang step naming it", async () => {
  const { ko, trace } = await build("Hledáme seniorního inženýra platformy, angličtina nutná, vlastnit ingest pipeline.", ["English"]);
  assert.equal(ko.length, 1);
  assert.match(ko[0].prompt, /English/);
  assert.deepEqual(trace?.droppedLanguages, []);
});

test("a need that names no language gives no ko_lang step, and the Ledger records the drop", async () => {
  const { ko, trace } = await build("Hledáme seniorního inženýra platformy, vlastnit ingest pipeline a služby.", ["English"]);
  assert.equal(ko.length, 0);
  assert.deepEqual(trace?.droppedLanguages, [{ text: "English", reason: "unstated" }]);
});

test("'No English needed' gives no ko_lang step, and the Ledger says it was stated as not needed", async () => {
  const { ko, trace } = await build("Senior platform engineer owning the ingest pipeline. No English needed.", ["English"]);
  assert.equal(ko.length, 0);
  assert.deepEqual(trace?.droppedLanguages, [{ text: "English", reason: "negated" }]);
});
