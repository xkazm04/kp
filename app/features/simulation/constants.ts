// Pipeline simulation — shared constants. The canned JD lets the deterministic
// "spine" run end-to-end with ZERO LLM keys (no jd_build / Gemini needed): the
// role sources real seeded candidates and walks one to Hired.

import { applyCompanyTemplate } from "./company-template";

export const SIM_MARKER = "(SIM)"; // every sim artifact's title carries this — used to reset cleanly
// The marker is BOTH a purge key (resetSim deletes by it) and a read-side filter
// key (gsim-l2-105 / REC-11): live aggregates — analytics funnel/ROI, the Today
// rail — must never count demo residue as real hiring data. Both derivations are
// single-sourced here so the writer, the purge and every filter can't drift.
/** SQL LIKE pattern matching any sim-marked title (pair with a `LIKE ?` param). */
export const SIM_TITLE_LIKE = `%${SIM_MARKER}%`;
/** True when a job/entry title carries the sim marker. NULL/undefined titles are
 *  real data (analysis-only entries) and must be kept by callers filtering rows. */
export function isSimTitle(title: string | null | undefined): boolean {
  return typeof title === "string" && title.includes(SIM_MARKER);
}
/** Stamp the (SIM) marker onto a title so a simulated pipeline entry is purgeable
 *  by resetSim AND excluded by every analytics filter — the ONE marker the writer,
 *  the purge and every aggregate share (single-sourced here so they can't drift).
 *  Idempotent: an already-marked title is returned unchanged (never "(SIM) (SIM)"). */
export function markSimTitle(title: string): string {
  return isSimTitle(title) ? title : `${title} ${SIM_MARKER}`;
}
export const SIM_TITLE = `Senior Java Backend Engineer ${SIM_MARKER}`;
export const SIM_COMPANY = "Česká spořitelna";

// A RoleSpec shaped exactly like the JD builder's output, so /api/jds/save can
// ingest a structured Job AND source candidates against it.
export const SIM_ROLE = {
  title: SIM_TITLE,
  seniority: "senior",
  roleFamily: "software_engineering",
  languages: ["Czech", "English"],
  responsibilities: ["Own core banking backend services", "Mentor the team", "Drive API & data-model design"],
  mustHaves: ["Java", "Spring", "SQL", "REST"],
  niceToHaves: ["Kafka", "Kubernetes", "AWS"],
};

export const SIM_SALARY = { suggestedMinimum: 120000, suggestedMaximum: 165000 };

// Richer, company-branded JD output (Phase 1 "simulate output" + template).
export const SIM_JD_MARKDOWN = applyCompanyTemplate({
  title: SIM_TITLE,
  company: SIM_COMPANY,
  seniority: SIM_ROLE.seniority,
  responsibilities: SIM_ROLE.responsibilities,
  mustHaves: SIM_ROLE.mustHaves,
  niceToHaves: SIM_ROLE.niceToHaves,
  salaryBand: [SIM_SALARY.suggestedMinimum, SIM_SALARY.suggestedMaximum],
  currency: "CZK",
});

// ── Demo screening coupling: SIM_SCREEN_POLICY ─────────────────────────────
// Two magic numbers in different files are silently coupled, and the demo's
// headline promise ("follow this candidate to Hired") depends on the relation
// between them. They're single-sourced HERE as ONE policy object so the
// coupling is reviewable — and assertable — in one place. Both sides read it:
//
//   • screenWaveOverride — the override SimulationProvider's screen step sends
//     to /api/decisions/screen-wave for the scripted screening wave. Its
//     `maxMatchToReject` is the REJECT CEILING: a candidate in the bottom
//     `rejectBottomPercent` whose match is below this gets auto-rejected.
//   • inboundScoreFloor — the floor of the deterministic score handed to the
//     scripted inbound applicant in /api/sim/inbound (score = floor +
//     charCode % 10, i.e. a 10-point band starting at the floor).
//
// INVARIANT: inboundScoreFloor MUST stay strictly above
// screenWaveOverride.maxMatchToReject. If it doesn't, the scripted applicant
// lands at/under the ceiling and gets auto-rejected mid-demo — breaking the
// walk to Hired in a baffling way, with no test catching it. Two guards keep it
// honest: the module-load check below fails fast (loudly) at import, and
// constants.test.ts pins the invariant in CI (`npm run test:unit`).
export const SIM_SCREEN_POLICY = {
  screenWaveOverride: {
    autoRejectEnabled: true,
    rejectBottomPercent: 25,
    maxMatchToReject: 60, // reject ceiling — must stay below inboundScoreFloor
  },
  inboundScoreFloor: 62, // must stay > screenWaveOverride.maxMatchToReject
} as const;

if (SIM_SCREEN_POLICY.inboundScoreFloor <= SIM_SCREEN_POLICY.screenWaveOverride.maxMatchToReject) {
  throw new Error(
    `Sim demo invariant violated: inbound score floor (${SIM_SCREEN_POLICY.inboundScoreFloor}) must exceed the screen reject ceiling (${SIM_SCREEN_POLICY.screenWaveOverride.maxMatchToReject}), or the scripted applicant is auto-rejected mid-demo.`,
  );
}

// The chronological phases shown on the bar (supporting nav). Each maps to the
// tab a user would be on for that part of the journey.
export type SimPhaseId = "design" | "source" | "match" | "screen" | "interview" | "offer" | "hired";

export const SIM_PHASES: { id: SimPhaseId; label: string; tab: string }[] = [
  { id: "design", label: "Design JD", tab: "library" },
  { id: "source", label: "Source", tab: "jobs" },
  { id: "match", label: "Intake", tab: "channels" },
  { id: "screen", label: "Screen", tab: "analytics" },
  { id: "interview", label: "Interview", tab: "schedule" },
  { id: "offer", label: "Offer", tab: "decisions" },
  { id: "hired", label: "Hired", tab: "pipeline" },
];
