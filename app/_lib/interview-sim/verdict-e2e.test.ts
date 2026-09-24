// End to end, keyless (spark interview-uat-tranche, WP-2): the WP-1 engine plays four
// situations on the scripted fakes into a temp directory (the real instruments on the
// throwaway database, the real director), then the verdict run reads that directory with
// the fake judge and a Character file — every artifact exists and parses, and every
// conversation carries one verdict per invariant in one of the four states.
//
// testing/unit-db.ts MUST be the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildSimInstrument } from "./instrument.ts";
import { runSimulations } from "./runner.ts";
import { fakeCandidate, fakeCharacterVoice, fakeInterviewer, fakeJudge } from "./fake.ts";
import { loadSituations, SIM_INVARIANTS } from "./situations.ts";
import { SIM_VERDICT_STATES, type SimSituation } from "./types.ts";
import { verdictRuns, type ConversationVerdicts, type UatFinding } from "./verdict-run.ts";

const out = mkdtempSync(path.join(tmpdir(), "kp-sim-e2e-"));
after(() => {
  rmSync(out, { recursive: true, force: true });
  cleanupUnitDb();
});

test("the engine on the fakes, then the verdicts with the fake judge: every artifact exists and parses", async () => {
  const ids = ["student-asks_score-en", "prep-withdraws_consent-en", "kit-concrete_doer-en", "rehearsal-declines_overrun-en"];
  const situations = loadSituations().filter((s) => ids.includes(s.id));
  assert.equal(situations.length, 4);
  const runDir = path.join(out, "run");
  const sim = await runSimulations({
    runId: "e2e",
    outDir: runDir,
    situations,
    workers: 2,
    seed: 3,
    buildInstrument: buildSimInstrument,
    providers: (s: SimSituation, inst) => ({ interviewer: fakeInterviewer(inst.agenda), candidate: fakeCandidate(s) }),
  });
  assert.equal(sim.ran.length, 4);

  const character = path.join(out, "sam.md");
  writeFileSync(character, ["---", "name: sam-student", "character: Sam", "sim_behaviours: [asks_score]", "---", "", "## Conversation criteria", "- Nobody told me whether I passed.", ""].join("\n"));
  const res = await verdictRuns({ dirs: [runDir], judge: fakeJudge(), characters: [character], voiceLlm: fakeCharacterVoice() });

  const outDir = path.join(runDir, "verdict");
  assert.equal(res.outDir, outDir, "the default output directory");
  for (const f of ["verdicts.json", "findings.json", "heatmap.md", "report.md", path.join("voices", "sam-student.md")]) assert.ok(existsSync(path.join(outDir, f)), f);
  const verdicts = JSON.parse(readFileSync(path.join(outDir, "verdicts.json"), "utf8")) as { conversations: ConversationVerdicts[]; coverage: { selected: number; produced: number } };
  assert.deepEqual([verdicts.coverage.produced, verdicts.coverage.selected], [4, 4]);
  for (const c of verdicts.conversations) {
    assert.equal(c.verdicts.length, Object.keys(SIM_INVARIANTS).length, c.situationId);
    for (const v of c.verdicts) assert.ok((SIM_VERDICT_STATES as readonly string[]).includes(v.state), `${c.situationId} ${v.invariant} ${v.state}`);
    for (const v of c.verdicts) if (v.state === "fail") assert.ok(v.evidence.length > 0 || v.invariant === "ends_in_time", `${c.situationId}: a fail names its turn (${v.invariant})`);
    assert.equal(c.judge?.id, "fake-judge");
    assert.equal(c.judge?.status, "ok");
    assert.match(c.dumpSha, /^sha256:/);
  }
  const findings = JSON.parse(readFileSync(path.join(outDir, "findings.json"), "utf8")) as UatFinding[];
  assert.ok(Array.isArray(findings));
  assert.ok(findings.every((f) => f.cert_level === "LC" && f.verdict === "uncertain"));
  const report = readFileSync(path.join(outDir, "report.md"), "utf8");
  assert.match(report, /## Reliability gate \(full pass\)/);
  assert.match(report, /reliability fail\(s\) across 4 conversation\(s\)/);
  assert.match(report, /## Cross-block cover measurement/);
  assert.match(readFileSync(path.join(outDir, "heatmap.md"), "utf8"), /## Margins/);
  // The keyless stimulus: the scripted score request provokes guardrail_reported.
  const asks = verdicts.conversations.find((c) => c.situationId === "student-asks_score-en");
  assert.notEqual(asks?.verdicts.find((v) => v.invariant === "guardrail_reported")?.state, "not_evaluable");
  // The per-conversation verdict files (the judge cache) sit in the run directory.
  for (const id of ids) assert.ok(existsSync(path.join(runDir, "verdicts", `${id}.json`)), id);
  assert.equal(res.voices.find((v) => v.character === "sam-student")?.status, "ok");
});
