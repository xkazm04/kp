// Phase 2 brief-bridge for the voice-interviewer eval.
//
// Emits the EXACT production interviewer brief (the same strings the live agent is given)
// so the Python eval harness can test the real briefs instead of a Python re-render.
// Run with the same TS loader the unit tests use:
//
//   node --import ./scripts/test-alias-loader.mjs --experimental-transform-types \
//     scripts/interview-brief.ts --brief student --role "a junior engineering role"
//
// Prints JSON `{ "brief": "<the brief string>" }` to stdout. `--brief` ∈ default | student | case.
// (`composeBrief`/grounded prep-chronology needs a live pipeline entry + DB, so it isn't emitted
// headlessly here — default/student/case are the pure builders. See docs/VOICE_INTERVIEW_TEST_FRAMEWORK.md.)

import { defaultInterviewerInstructions } from "@/app/_lib/voice/index";
import {
  DEMO_CASE_SCENARIO,
  caseGroundedInterviewerInstructions,
  studentInterviewerInstructions,
} from "@/app/_lib/student-interview";

function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

const kind = arg("brief") ?? "default";
const role = arg("role") ?? null;
const company = arg("company") ?? null;
const candidate = arg("candidate") ?? null;
const durationRaw = arg("duration");
const durationMin = durationRaw ? Number(durationRaw) : null;

let brief: string;
if (kind === "student") {
  brief = studentInterviewerInstructions({ roleLine: role, company, candidateLabel: candidate });
} else if (kind === "case") {
  brief = caseGroundedInterviewerInstructions(DEMO_CASE_SCENARIO, { roleLine: role, company, candidateLabel: candidate });
} else {
  brief = defaultInterviewerInstructions({ role, durationMin });
}

process.stdout.write(JSON.stringify({ brief }));
