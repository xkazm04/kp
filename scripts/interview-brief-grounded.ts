// DB-fixture bridge for the voice-interviewer eval (Phase 2 leftover).
//
// Emits the REAL grounded prep-chronology brief — composeBrief() via the actual
// buildGroundedInterview(entryId) — which the pure brief-bridge can't reach because it reads a
// pipeline entry + interview_prep artifact from the DB. This seeds a THROWAWAY entry + prep into
// the database at KP_DB_PATH (the CALLER must point that at a temp file — never the real DB) and
// renders the brief through the production path, so branch selection + composeBrief + duration
// are all exercised verbatim.
//
//   KP_DB_PATH=/tmp/grounded.sqlite node --import ./scripts/test-alias-loader.mjs \
//     --experimental-transform-types scripts/interview-brief-grounded.ts --title "Senior Backend Engineer"
//
// Prints JSON { brief, runOfShow, durationMin }. Pass --prep <path> to a JSON chronology array to
// override the built-in fixture. --candidate sets the candidate label.

import { readFileSync } from "node:fs";

import { createPipelineEntry } from "@/app/_lib/db/pipeline";
import { saveInterviewPrep } from "@/app/_lib/interview-prep";
import { buildGroundedInterview } from "@/app/_lib/interview-run";

function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

const title = arg("title") ?? "Senior Backend Engineer";
const candidateLabel = arg("candidate") ?? "Candidate";

// A realistic grounded prep — the same shape interview-prep-run produces (topic / min window /
// goal / questions / optional follow-up). This is the fixture the eval tests the grounded brief
// against; override with --prep for a specific case.
const DEFAULT_CHRONOLOGY = [
  {
    fromMin: 0, toMin: 5, topic: "Recent backend ownership",
    goal: "Establish what they actually built and owned end to end.",
    questions: [
      "Walk me through the most complex service you owned end to end.",
      "What was genuinely your decision versus the team's?",
    ],
  },
  {
    fromMin: 5, toMin: 12, topic: "Design trade-offs",
    goal: "Probe the why behind the what — reasoning over recall.",
    questions: ["Why that datastore over the alternatives?", "What breaks first under 10x load?"],
    followUp: "Where did that design bite you later, and what did you change?",
  },
  {
    fromMin: 12, toMin: 18, topic: "Incidents & recovery",
    goal: "How they behave when production breaks — the best ramp-up predictor.",
    questions: ["Tell me about a production incident you led. What was the loop from alert to fix?"],
  },
  {
    fromMin: 18, toMin: 22, topic: "Direction & their questions",
    goal: "Intrinsic motivation and what they want next.",
    questions: ["What kind of problems do you want to be working on a year from now?"],
  },
];

const prepPath = arg("prep");
const chronology = prepPath ? JSON.parse(readFileSync(prepPath, "utf-8")) : DEFAULT_CHRONOLOGY;

// A non-early-career archetype + a jobId with no job row → buildGroundedInterview takes the
// grounded prep-chronology branch (not debrief / student / case) and defaults company/title.
const { entry } = createPipelineEntry({
  candidateId: "eval-cand-grounded",
  candidateLabel,
  archetype: "bau",
  jobId: "eval-fixture-role",
  jobTitle: title,
});

saveInterviewPrep(entry.id, candidateLabel, title, {
  scenario: "Grounded senior screen (eval fixture)",
  durationMin: 22,
  focusAreas: ["backend depth", "system design", "incident response"],
  chronology,
});

const out = await buildGroundedInterview(entry.id);
process.stdout.write(
  JSON.stringify({ brief: out.instructions, runOfShow: out.runOfShow, durationMin: out.durationMin }),
);
