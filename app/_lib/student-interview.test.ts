// Guards the case-designed-interview contract on the TS side.
//
// The six-phase thought-script lives in ONE file — pipeline/jobfit/interview-script.json
// — read directly by BOTH this module (the About viz, the simulator, the agent
// briefs) and the Python scenario generator (devcase/interview_scenario.py, pinned
// by test_interview_scenario.py). This test pins the TS half: STUDENT_SCRIPT IS
// the JSON (no re-hardcoded copy), and the briefs the voice agent actually runs
// really carry every phase, the deliberate hint contract, and — for the
// case-grounded variant — the narrated case material with probes kept internal.
//
// Runner: Node's built-in test runner with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Same minimal hooks as interview-rubric.test.ts: resolve "@/", extensionless TS,
// and JSON imports so we can load the REAL module rather than a copy of its logic.
const ROOT = new URL("../../", import.meta.url).href; // repo root (app/_lib/ -> ../../)
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if (spec.startsWith("@/")) spec = new URL(spec.slice(2), ROOT).href;
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts";
    }
    return nextResolve(spec, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".json")) {
      const source = "export default " + readFileSync(fileURLToPath(url), "utf8") + ";";
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

type RawPhase = {
  phase: string;
  minutes: string;
  goal: string;
  probe: string;
  listenFor: string;
  feeds: string[];
  caseGrounded?: boolean;
};
type RawScript = { durationMin: number; phases: RawPhase[] };
const SOURCE: RawScript = JSON.parse(
  readFileSync(new URL("../../pipeline/jobfit/interview-script.json", import.meta.url), "utf8")
);

const {
  STUDENT_SCRIPT,
  STUDENT_SCRIPT_MIN,
  studentRunOfShow,
  studentInterviewerInstructions,
  caseGroundedInterviewerInstructions,
  scenarioRunOfShow,
  devCaseIdFromJobId,
  submissionIdFromCandidateId,
  DEMO_CASE_SCENARIO,
} = await import("@/app/_lib/student-interview.ts");

test("STUDENT_SCRIPT and the duration ARE the JSON (no re-hardcoded copy)", () => {
  assert.deepEqual(STUDENT_SCRIPT, SOURCE.phases);
  assert.equal(STUDENT_SCRIPT_MIN, SOURCE.durationMin);
});

test("run-of-show is the phase names, in script order", () => {
  assert.deepEqual(
    studentRunOfShow(),
    SOURCE.phases.map((p) => p.phase)
  );
});

test("the generic brief carries every phase and the deliberate-hint contract", () => {
  const brief = studentInterviewerInstructions();
  for (const p of SOURCE.phases) assert.ok(brief.includes(p.phase), `brief is missing phase: ${p.phase}`);
  assert.ok(brief.includes("ONE concrete hint"), "the coachability hint is non-negotiable");
  assert.ok(!brief.includes("undefined"), "no leaked undefineds in the composed brief");
});

test("the case-grounded brief narrates the case, carries every probe, keeps mechanics internal", () => {
  const brief = caseGroundedInterviewerInstructions(DEMO_CASE_SCENARIO);
  assert.ok(brief.includes(DEMO_CASE_SCENARIO.caseIntro), "the case intro is narrated to the candidate");
  for (const p of DEMO_CASE_SCENARIO.phases) {
    assert.ok(brief.includes(p.probe), `brief is missing the probe for: ${p.phase}`);
  }
  assert.ok(brief.includes("NEVER reveal"), "scripted probes stay internal");
  assert.deepEqual(
    scenarioRunOfShow(DEMO_CASE_SCENARIO),
    SOURCE.phases.map((p) => p.phase)
  );
});

test("devCaseIdFromJobId resolves only dev-case jobIds", () => {
  // The "dc-" prefix is stamped by devcase-orchestrator's proactive sourcing.
  assert.equal(devCaseIdFromJobId("dc-dc_abc123"), "dc_abc123");
  assert.equal(devCaseIdFromJobId("job-42"), null);
  assert.equal(devCaseIdFromJobId(null), null);
  assert.equal(devCaseIdFromJobId(undefined), null);
});

test("submissionIdFromCandidateId resolves only dev-case submission candidates", () => {
  // The "ds-" prefix is stamped by devcase-run.promoteSubmission — the key to the
  // eval bundle whose minted follow-ups ground the submission-debrief interview.
  assert.equal(submissionIdFromCandidateId("ds-sub_9f3"), "sub_9f3");
  assert.equal(submissionIdFromCandidateId("cand-7"), null);
  assert.equal(submissionIdFromCandidateId(null), null);
  assert.equal(submissionIdFromCandidateId(undefined), null);
});

test("the demo scenario instantiates exactly the case-grounded phases", () => {
  const grounded = new Set(SOURCE.phases.filter((p) => p.caseGrounded).map((p) => p.phase));
  for (const p of DEMO_CASE_SCENARIO.phases) {
    const changed = p.caseRef != null && p.caseRef !== "";
    assert.equal(changed, grounded.has(p.phase), `${p.phase}: caseRef presence should match caseGrounded`);
  }
});
