// Builds the Cohort Studio fixtures from the deterministic seed corpus, through the REAL
// engine (projectCohortMember + assembleCohortView), so the prototype worlds render
// exactly what the engine emits — never a hand-written view that could drift from it.
//
//   node --experimental-transform-types app/features/tools/analyze/cohort/fixture/buildFixture.ts
//
// Writes cohort20.done.json and cohort20.running.json to public/dev/cohort/ (static data, not code:
// kept off every import graph, fetched only by the dev-only prototype switcher). Deterministic:
// two runs produce byte-identical files (no clock, no randomness, fixed timestamps).
//
// The seeds (data/seed_analyses/analyses.json, 66 fictional candidates) were each scored
// against their OWN drafted JD, so their jobFit says nothing about a shared role. A cohort
// compares everyone against ONE role, so jobFit is re-derived here, deterministically,
// against data/seed_jobs/jobs.json job-000 (Senior Java Backend Engineer): matched/missing
// from that job's must-have requirements vs the candidate's listed skills. Everything a
// seed does not carry (soft signals, trust findings, a GitHub read, a second currency) is
// synthesized from the tables below so the fixture exercises every engine path.
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Analysis, GithubAnalysis } from "../../../../../_lib/schemas.ts";
import type { CohortComments, CohortView, Membership, MemberRunState, RoleBand } from "../cohortTypes.ts";
import { assembleCohortView, projectCohortMember, type ProjectedMember } from "../cohortProject.ts";

const ROOT = new URL("../../../../../../", import.meta.url);
const OUT_DIR = new URL("public/dev/cohort/", ROOT);

// ---- the role ------------------------------------------------------------------------

type SeedJob = { id: string; title: string; company: string; seniority: string; role_family: string; requirements: Array<{ skill: string; kind: string }> };
type Seed = { id: string; candidate_label: string; payload: Analysis };

const ROLE_BAND: RoleBand = { currency: "CZK", period: "month", min: 110000, max: 160000 };
const COHORT_BASE = {
  cohortId: "cohort-fixture-20",
  jdSlug: "senior-java-backend-engineer",
  jdTitle: "Senior Java Backend Engineer",
  orgName: "Česká spořitelna",
  blind: false,
  reportLang: "en",
  createdAt: "2026-10-08T09:12:00.000Z",
};

// ---- the roster ----------------------------------------------------------------------

type Sig = [key: string, confidence: number];
interface Spec {
  seed: string;
  membership: Membership;
  /** done | reused | failed: the run state in the finished fixture. */
  state: "done" | "reused" | "failed";
  /** Expected monthly midpoint; currency defaults to CZK. */
  salary?: number;
  currency?: "CZK" | "EUR";
  /** A small, recorded adjustment on the derived fit score (evidence the skill list does not show). */
  fitNudge?: number;
  unproven?: string[];
  riskFlags?: string[];
  strengths?: Sig[];
  flags?: Sig[];
  /** null = soft signals not read (an older or keyless analysis). */
  signalsRead?: boolean;
  trust?: Array<{ code: string; severity: "warn" | "blocker"; scope: "identity" | "authenticity" | "skills" | "input" | "salary"; text: string }> | null;
  github?: "done" | "error" | "none" | "noLink";
  keyless?: boolean;
  skillsOverride?: string[];
  educationOverride?: string;
}

const ROSTER: Spec[] = [
  // applicants (8)
  { seed: "cand-000", membership: "applicant", state: "done", salary: 155000, fitNudge: 2, strengths: [["ownership", 0.7], ["impact", 0.6]], flags: [], trust: [{ code: "title_unverified", severity: "warn", scope: "input", text: "The tech-lead title appears in the summary but in no listed role." }], github: "done" },
  { seed: "cand-040", membership: "applicant", state: "done", salary: 168000, fitNudge: -1, strengths: [["domain", 0.7], ["ownership", 0.5]], flags: [["hopping", 0.4]], trust: [{ code: "employment_overlap", severity: "warn", scope: "identity", text: "Two full-time roles overlap for 9 months (2021–2022)." }], github: "done" },
  { seed: "cand-007", membership: "applicant", state: "done", salary: 145000, unproven: ["Microservices architecture"], strengths: [["domain", 0.8], ["impact", 0.5]], flags: [["vagueScope", 0.3]], trust: [], github: "done" },
  { seed: "cand-047", membership: "applicant", state: "done", salary: 150000, fitNudge: -3, strengths: [["domain", 0.5]], flags: [["vagueScope", 0.5]], trust: [{ code: "date_gap", severity: "warn", scope: "input", text: "An 18-month gap between roles is not explained." }], github: "noLink" },
  { seed: "cand-016", membership: "applicant", state: "done", salary: 60000, strengths: [["learning", 0.6]], flags: [], trust: [], github: "none" },
  { seed: "cand-030", membership: "applicant", state: "done", salary: 3600, currency: "EUR", educationOverride: "unknown", strengths: [["learning", 0.5]], flags: [["keywords", 0.4]], trust: [], github: "none" },
  { seed: "cand-013", membership: "applicant", state: "done", salary: 115000, strengths: [["domain", 0.6], ["impact", 0.6]], flags: [], trust: [] },
  { seed: "cand-004", membership: "applicant", state: "failed" },
  // matched by pool rank (10)
  { seed: "cand-039", membership: "matched", state: "done", salary: 150000, unproven: ["Oracle"], strengths: [["domain", 0.7], ["mentoring", 0.5]], flags: [["stagnation", 0.3]], trust: [], github: "none" },
  { seed: "cand-032", membership: "matched", state: "done", salary: 62000, strengths: [["learning", 0.7]], flags: [], trust: [], github: "none" },
  { seed: "cand-024", membership: "matched", state: "done", salary: 58000, strengths: [["learning", 0.5]], flags: [["keywords", 0.3]], trust: [], github: "error" },
  { seed: "cand-015", membership: "matched", state: "done", salary: 55000, riskFlags: ["CV text closely matches another applicant's CV."], strengths: [["learning", 0.9], ["impact", 0.8], ["mentoring", 0.5]], flags: [["keywords", 0.4]], trust: [{ code: "duplicate_text", severity: "blocker", scope: "authenticity", text: "Most of the experience section matches another applicant's CV word for word." }], github: "none" },
  { seed: "cand-022", membership: "matched", state: "done", salary: 150000, strengths: [["impact", 0.6], ["ownership", 0.5]], flags: [], trust: [], github: "none" },
  { seed: "cand-012", membership: "matched", state: "reused", salary: 140000, strengths: [["ownership", 0.9], ["mentoring", 0.8], ["domain", 0.6]], flags: [], trust: null, keyless: true, github: "none" },
  { seed: "cand-042", membership: "matched", state: "done", salary: 6200, currency: "EUR", strengths: [["ownership", 0.6]], flags: [["hopping", 0.5]], trust: [], github: "none" },
  { seed: "cand-003", membership: "matched", state: "done", salary: 135000, strengths: [["impact", 0.8], ["mentoring", 0.8], ["ownership", 0.5]], flags: [["keywords", 0.4]], trust: [{ code: "skills_unevidenced", severity: "warn", scope: "skills", text: "Four listed skills appear in no role description." }], github: "none" },
  { seed: "cand-048", membership: "matched", state: "reused", salary: 125000, skillsOverride: ["Scrum", "Jira"], strengths: [["domain", 0.4]], flags: [], trust: [] },
  { seed: "cand-037", membership: "matched", state: "failed" },
  // added by hand (2)
  { seed: "cand-005", membership: "added", state: "done", salary: 160000, signalsRead: false, trust: [], github: "none" },
  { seed: "cand-033", membership: "added", state: "reused", salary: 72000, strengths: [["impact", 0.8], ["mentoring", 0.7], ["domain", 0.6], ["learning", 0.5]], flags: [], trust: null, keyless: true },
];

/** In the RUNNING fixture: these have landed (7), this one failed (1), the rest are in flight (12). */
const RUNNING_DONE = new Set(["cand-000", "cand-040", "cand-007", "cand-047", "cand-016", "cand-013", "cand-012"]);
const RUNNING_FAILED = "cand-004";
const RUNNING_ANALYZING = new Set(["cand-030", "cand-039", "cand-032"]);

// ---- soft-signal library (realistic hypotheses, each with a probe) ------------------------

const SIGNALS: Record<string, { kind: "strength" | "antipattern"; label: string; detail: string; probe: string }> = {
  ownership: { kind: "strength", label: "Owns production systems end to end", detail: "Ran the on-call rota and carried a service rewrite through to measured latency gains.", probe: "Walk me through the last incident you owned, from the page to the post-mortem." },
  impact: { kind: "strength", label: "States outcomes with numbers", detail: "Results are quantified (latency, throughput, cost) rather than listed as duties.", probe: "Which of those numbers did you measure yourself, and how?" },
  mentoring: { kind: "strength", label: "Grows other engineers", detail: "Mentored two engineers through a promotion cycle and ran the team's code-review guild.", probe: "Tell me about someone you mentored who outgrew you on a topic." },
  domain: { kind: "strength", label: "Regulated-banking delivery", detail: "Shipped payment and core-banking integrations under audit and change-control rules.", probe: "How did a regulatory constraint change a design decision you made?" },
  learning: { kind: "strength", label: "Picks up a stack quickly", detail: "Moved from coursework to a production Spring service within one internship.", probe: "What did you have to unlearn when you moved to production code?" },
  hopping: { kind: "antipattern", label: "Short tenures", detail: "Three employers in four years; each role ended before a full delivery cycle.", probe: "What did you leave unfinished at your last role, and why did you move?" },
  vagueScope: { kind: "antipattern", label: "Team results written as personal ones", detail: "Outcomes are stated for the team; the candidate's own share is not separated out.", probe: "Which part of that migration would not have happened without you?" },
  keywords: { kind: "antipattern", label: "Skills listed without evidence", detail: "Several listed technologies appear in no project or role description.", probe: "Pick two listed skills and describe where you used them last." },
  stagnation: { kind: "antipattern", label: "Same scope for many years", detail: "The last six years show the same service and the same responsibilities.", probe: "What is the biggest change in what you own since you joined?" },
};

function softSignals(spec: Spec): Analysis["softSignals"] {
  if (spec.signalsRead === false) return null;
  const item = ([key, confidence]: Sig) => {
    const s = SIGNALS[key];
    return { key, kind: s.kind, label: s.label, detail: s.detail, evidence: [], confidence, source: "cv", needsConfirmation: true, suggestedProbe: s.probe, probeKind: "interview" };
  };
  const strengths = (spec.strengths ?? []).map(item);
  const antipatterns = (spec.flags ?? []).map(item);
  return { displayName: null, strengths, antipatterns, summary: `${strengths.length} strengths, ${antipatterns.length} flags to probe.` };
}

// ---- job fit against the ONE role --------------------------------------------------------

const lc = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").trim();
/** "REST" ~ "REST APIs", "Microservices architecture" ~ "Microservices", "Kubernetes / OpenShift" ~ "Kubernetes". */
function skillMatches(requirement: string, skill: string): boolean {
  const c = lc(skill);
  return lc(requirement)
    .split(" / ")
    .map((a) => a.trim())
    .some((a) => c === a || c.startsWith(`${a} `) || a.startsWith(`${c} `));
}

const SENIORITY_FIT: Record<string, number> = { junior: 0.3, medior: 0.6, senior: 1, lead: 1 };
const FAMILY_FIT: Record<string, number> = { software_engineering: 1, data_ai: 0.6 };

function jobFitFor(name: string, a: Analysis, spec: Spec, job: SeedJob): NonNullable<Analysis["jobFit"]> {
  const must = job.requirements.filter((r) => r.kind === "must_have").map((r) => r.skill);
  const unproven = spec.unproven ?? [];
  const matching = must.filter((m) => !unproven.includes(m) && a.candidate.skills.some((s) => skillMatches(m, s)));
  const missing = must.filter((m) => !unproven.includes(m) && !matching.includes(m));
  const family = a.candidate.roleFamily;
  const sen = a.candidate.currentSeniority;
  const ratio = (matching.length + 0.5 * unproven.length) / must.length;
  const score = Math.max(0, Math.min(100, Math.round(14 + 50 * ratio + 18 * (SENIORITY_FIT[sen] ?? 0.5) + 12 * (FAMILY_FIT[family] ?? 0.15) + (spec.fitNudge ?? 0))));
  const word = score >= 75 ? "strong" : score >= 55 ? "solid" : score >= 35 ? "partial" : "weak";
  const seniorityAlignment =
    sen === "senior" || sen === "lead" ? "Senior level matches the role's senior target." : sen === "medior" ? "One level below the role's senior target." : "Two levels below the role's senior target.";
  const roleAlignment =
    family === job.role_family ? `Same role family (${family}).` : FAMILY_FIT[family] ? `Adjacent role family (${family}).` : `Different role family (${family}).`;
  return {
    score,
    summary: `${name} is a ${word} fit (${score}/100) for ${job.title} at ${job.company}.`,
    matchingSkills: matching,
    missingSkills: missing,
    seniorityAlignment,
    roleAlignment,
    salaryAssessment: "",
    recommendations: [],
    interviewTalkingPoints: [],
    cvRewriteSuggestions: [],
    mustProveEvidence: [],
    negotiationAngle: "",
    recruiterRiskFlags: spec.riskFlags ?? [],
    unprovenSkills: unproven.length ? unproven : null,
  };
}

// ---- GitHub reads (synthesized, realistic) --------------------------------------------

const handleOf = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const GH_PROFILES: Record<string, { repos: number; active: number; stars: number; langs: Array<[string, number]>; matched: string[]; gaps: string[]; top: Array<[string, string, number]> }> = {
  "cand-000": { repos: 34, active: 9, stars: 412, langs: [["Java", 61], ["Kotlin", 14], ["Go", 12], ["Shell", 8], ["Dockerfile", 5]], matched: ["Java", "Spring Boot", "Kafka", "REST"], gaps: ["Oracle"], top: [["kafka-outbox-relay", "Java", 287], ["spring-idempotency-starter", "Java", 96], ["latency-budget", "Go", 21]] },
  "cand-040": { repos: 18, active: 5, stars: 37, langs: [["Java", 72], ["SQL", 15], ["Python", 13]], matched: ["Java", "Spring Boot", "Oracle"], gaps: ["Kafka", "REST"], top: [["oracle-flyway-demo", "Java", 22], ["spring-batch-recipes", "Java", 11], ["kata", "Python", 4]] },
  "cand-007": { repos: 9, active: 2, stars: 3, langs: [["Java", 80], ["Shell", 20]], matched: ["Java"], gaps: ["Kafka", "Spring Boot", "Oracle"], top: [["iso20022-parser", "Java", 3], ["dotfiles", "Shell", 0]] },
};

function githubFor(spec: Spec, name: string): Pick<Analysis, "githubDeepDive"> & { link: string | null } {
  const handle = handleOf(name);
  const link = spec.github === "noLink" || !spec.github ? null : `https://github.com/${handle}`;
  if (spec.github === "error") return { link, githubDeepDive: { status: "error", analysis: null, code: "RATE_LIMITED", retryAfterSec: 900 } };
  if (spec.github !== "done") return { link, githubDeepDive: null };
  const p = GH_PROFILES[spec.seed];
  const total = 1_000_000;
  const analysis: GithubAnalysis = {
    username: handle,
    profileUrl: `https://github.com/${handle}`,
    summary: `${handle}: ${p.repos} public repositories, mostly ${p.langs[0][0]}.`,
    analyzedAt: "2026-10-08T09:15:00.000Z",
    metrics: { publicRepos: p.repos, followers: Math.round(p.stars / 6), totalStars: p.stars, totalForks: Math.round(p.stars / 5), activeRepos: p.active, recentlyUpdatedRepos: p.active, ownedReposAnalyzed: Math.min(p.repos, 30) },
    languages: p.langs.map(([lang, percent]) => ({ name: lang, bytes: Math.round((total * percent) / 100), percent })),
    topRepositories: p.top.map(([repo, lang, stars]) => ({
      name: repo,
      url: `https://github.com/${handle}/${repo}`,
      description: null,
      primaryLanguage: lang,
      stars,
      forks: Math.round(stars / 6),
      updatedAt: "2026-09-21T10:00:00.000Z",
      pushedAt: "2026-09-21T10:00:00.000Z",
      topics: [],
      complexitySignals: [],
    })),
    contributionSignals: [],
    jobFitSignals: { jobDescriptionProvided: true, matchingSkills: p.matched, potentialGaps: p.gaps, trackedSkillCount: 120, complexityAssessment: "Moderate" },
    limitations: [],
  };
  return { link, githubDeepDive: { status: "done", analysis } };
}

// ---- one seed -> one Analysis ------------------------------------------------------------

const EXPERIENCE_BY_SENIORITY: Record<string, number> = { junior: 9, medior: 15, senior: 20, lead: 23 };

function analysisFor(seed: Seed, spec: Spec, job: SeedJob): Analysis {
  const src = seed.payload;
  const name = src.candidate.name ?? seed.candidate_label;
  const gh = githubFor(spec, name);
  const years = src.candidate.yearsExperience;
  const candidate = {
    ...src.candidate,
    skills: spec.skillsOverride ?? src.candidate.skills,
    educationLevel: spec.educationOverride ?? src.candidate.educationLevel,
    links: gh.link ? [gh.link] : [],
  };
  const experience = Math.min(25, Math.round(8 + 2 * years));
  const roleSeniority = Math.min(23, (EXPERIENCE_BY_SENIORITY[candidate.currentSeniority] ?? 12) + (years > 10 ? 1 : 0));
  const mid = spec.salary ?? src.salary.midpoint;
  const base: Analysis = {
    ...src,
    candidate,
    score: { ...src.score, experience, roleSeniority, total: Math.min(100, experience + roleSeniority + src.score.skills + src.score.education + src.score.traits) },
    salary: { ...src.salary, currency: spec.currency ?? "CZK", period: "month", midpoint: mid, minimum: Math.round(mid * 0.85), maximum: Math.round(mid * 1.15) },
    trustFindings: spec.trust === null ? null : (spec.trust ?? []).map((t) => ({ ...t, value: null })),
    softSignals: softSignals(spec),
    metadata: { ...(src.metadata ?? { analysisEngine: "", textExtractor: "", parsingNotes: [], groundingSources: [] }), analysisEngine: spec.keyless ? "seed-deterministic" : "gemini", engineKind: spec.keyless ? "deterministic" : "llm" },
    githubDeepDive: gh.githubDeepDive,
  };
  base.jobFit = jobFitFor(name, base, spec, job);
  return base;
}

// ---- the model's rare words (reorder-surviving, English) ------------------------------

function commentsFor(memberIdOf: (seed: string) => string): CohortComments {
  return {
    cells: [
      { memberId: memberIdOf("cand-000"), dimension: "publicWork", comment: "Maintains a Kafka outbox library others depend on." },
      { memberId: memberIdOf("cand-040"), dimension: "trust", comment: "Overlap is likely a notice period; confirm the dates." },
      { memberId: memberIdOf("cand-007"), dimension: "skills", comment: "Microservices claimed, not shown in any role." },
      { memberId: memberIdOf("cand-015"), dimension: "trust", comment: "Verify authorship before any further step." },
    ],
    notes: {
      fit: "The top two are close on fit; the band, not the order, is the finding.",
      salary: "Two expectations are in EUR and are shown on their own records, not compared.",
    },
    narrative: {
      covers: ["cand-000", "cand-040", "cand-007", "cand-039", "cand-016", "cand-047"].map(memberIdOf),
      leavesOut: 14,
      text:
        "Klára Blažková and David Kříž both cover every must-have for the backend role, and their fit bands overlap, so the order between them is not a finding. " +
        "Klára's public Kafka and Spring work corroborates her CV; David's overlapping roles need a date check before the interview. " +
        "Klára Kovářová and Vít Malý match the Java and Kafka core but each has one skill that is claimed rather than shown (Oracle, microservices). " +
        "Adam Malý covers every must-have at junior level; his experience, not his skills, is the gap. " +
        "Jan Mareš matches Vít Malý's skills but trails him on every compared dimension. " +
        "Fourteen members are not discussed here; their cells stand on their own.",
      engine: "model",
    },
  };
}

// ---- build ---------------------------------------------------------------------------------

export function buildCohortFixtures(): { done: CohortView; running: CohortView } {
  const seeds = JSON.parse(fs.readFileSync(new URL("data/seed_analyses/analyses.json", ROOT), "utf8")) as Seed[];
  const jobs = JSON.parse(fs.readFileSync(new URL("data/seed_jobs/jobs.json", ROOT), "utf8")) as SeedJob[];
  const job = jobs.find((j) => j.id === "job-000");
  if (!job) throw new Error("buildFixture: job-000 is missing from data/seed_jobs/jobs.json");
  const bySeed = new Map(seeds.map((s) => [s.id, s]));
  const memberIdOf = (seedId: string) => {
    const spec = ROSTER.find((r) => r.seed === seedId)!;
    return spec.membership === "matched" ? `profile:${seedId}` : `analysis-${seedId}`;
  };

  const project = (spec: Spec, runState: MemberRunState, landed: boolean): ProjectedMember => {
    const seed = bySeed.get(spec.seed);
    if (!seed) throw new Error(`buildFixture: seed ${spec.seed} is missing`);
    const analysis = landed ? analysisFor(seed, spec, job) : null;
    return projectCohortMember({
      memberId: memberIdOf(spec.seed),
      label: seed.payload.candidate.name ?? seed.candidate_label,
      membership: spec.membership,
      runState,
      analysisSlug: analysis ? `cohort-${spec.seed}` : null,
      analysis,
      blind: false,
      roleBand: ROLE_BAND,
    });
  };

  const done = assembleCohortView(
    { ...COHORT_BASE, status: "done", finishedAt: "2026-10-08T09:19:41.000Z" },
    ROSTER.map((spec) => project(spec, spec.state, spec.state !== "failed")),
    commentsFor(memberIdOf)
  );
  const running = assembleCohortView(
    { ...COHORT_BASE, status: "running", finishedAt: null },
    ROSTER.map((spec) => {
      if (spec.seed === RUNNING_FAILED) return project(spec, "failed", false);
      if (RUNNING_DONE.has(spec.seed)) return project(spec, spec.state === "reused" ? "reused" : "done", true);
      return project(spec, RUNNING_ANALYZING.has(spec.seed) ? "analyzing" : "queued", false);
    }),
    null
  );
  return { done, running };
}

export const serializeFixture = (view: CohortView): string => `${JSON.stringify(view, null, 2)}\n`;

function main(): void {
  const { done, running } = buildCohortFixtures();
  fs.writeFileSync(new URL("cohort20.done.json", OUT_DIR), serializeFixture(done));
  fs.writeFileSync(new URL("cohort20.running.json", OUT_DIR), serializeFixture(running));
  console.log(`wrote ${fileURLToPath(new URL("cohort20.done.json", OUT_DIR))} and cohort20.running.json`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
