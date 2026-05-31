// Pipeline simulation — shared constants. The canned JD lets the deterministic
// "spine" run end-to-end with ZERO LLM keys (no jd_build / Gemini needed): the
// role sources real seeded candidates and walks one to Hired.

export const SIM_MARKER = "(SIM)"; // every sim artifact's title carries this — used to reset cleanly
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

export const SIM_JD_MARKDOWN = [
  `# ${SIM_TITLE}`,
  "",
  "## About the role",
  "Own core banking backend services, mentor the team, and drive API & data-model design.",
  "",
  "## Must-haves",
  "- Java, Spring, SQL, REST",
  "",
  "## Nice-to-haves",
  "- Kafka, Kubernetes, AWS",
].join("\n");

// The chronological phases shown on the bar (supporting nav). Each maps to the
// tab a user would be on for that part of the journey.
export type SimPhaseId = "design" | "source" | "match" | "screen" | "interview" | "offer" | "hired";

export const SIM_PHASES: { id: SimPhaseId; label: string; tab: string }[] = [
  { id: "design", label: "Design JD", tab: "library" },
  { id: "source", label: "Source", tab: "pipeline" },
  { id: "match", label: "Auto-match", tab: "pipeline" },
  { id: "screen", label: "Screen", tab: "decisions" },
  { id: "interview", label: "Interview", tab: "schedule" },
  { id: "offer", label: "Offer", tab: "decisions" },
  { id: "hired", label: "Hired", tab: "pipeline" },
];
