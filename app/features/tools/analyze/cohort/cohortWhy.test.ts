// The why-engine (cohortWhy.ts) on handcrafted analyses: each dimension's mapping, the exact
// anatomy, fit's point-free reasons, the cohort's criteria union, blind redaction, the caps
// and the absent -> null rule. The fixture-wide invariants live in fixture/cohortFixture.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleCohortView, projectCohortMember, type ProjectInput } from "./cohortProject.ts";
import { apportion } from "./cohortFormula.ts";
import { WHY_CAP, capReasons, publicWorkWhy, seniorityStatus } from "./cohortWhy.ts";
import { COHORT_DIMENSIONS, type CohortView, type MemberDimensionWhy, type Reason, type RoleContext } from "./cohortTypes.ts";
// Type-only (erased by the strip-only runner) so this file stays dependency-free.
import type { Analysis, GithubAnalysis } from "../../../../_lib/schemas.ts";

type Over = Partial<Omit<Analysis, "candidate" | "jobFit">> & {
  candidate?: Partial<Analysis["candidate"]>;
  jobFit?: Partial<NonNullable<Analysis["jobFit"]>> | null;
};

const signal = (key: string, label: string, confidence: number, probe = `Ask about ${label}.`) => ({
  key,
  kind: "k",
  label,
  detail: `${label}, in detail.`,
  evidence: [],
  confidence,
  source: "cv",
  needsConfirmation: true,
  suggestedProbe: probe,
});

function analysis(over: Over = {}): Analysis {
  const { candidate, jobFit, ...rest } = over;
  return {
    candidate: {
      name: "Jana Nováková",
      rawText: "",
      yearsExperience: 7,
      currentSeniority: "senior",
      roleFamily: "software_engineering",
      skills: ["Java", "Kafka", "SQL"],
      educationLevel: "master",
      languages: [],
      traits: [],
      evidence: [],
      links: [],
      ...candidate,
    },
    score: { total: 80, experience: 20, skills: 25, roleSeniority: 20, education: 10, traits: 5 },
    salary: { currency: "CZK", period: "month", minimum: 100000, maximum: 140000, midpoint: 120000, confidence: "medium", rationale: [] },
    strengths: ["Ships Kafka pipelines."],
    gaps: ["No Oracle."],
    recommendations: [],
    explanation: "",
    sanityChecks: [],
    trustFindings: [],
    jobFit:
      jobFit === null
        ? null
        : {
            score: 70,
            summary: "",
            matchingSkills: ["Java", "Kafka"],
            missingSkills: [],
            seniorityAlignment: "Jana Nováková is at the senior target.",
            roleAlignment: "Same family.",
            salaryAssessment: "Inside the band.",
            recommendations: [],
            interviewTalkingPoints: [],
            cvRewriteSuggestions: [],
            mustProveEvidence: ["Kafka at scale."],
            negotiationAngle: "",
            recruiterRiskFlags: [],
            ...jobFit,
          },
    metadata: { analysisEngine: "gemini", textExtractor: "pypdf", engineKind: "llm", parsingNotes: [], groundingSources: [] },
    softSignals: { displayName: null, strengths: [], antipatterns: [], summary: "" },
    ...rest,
  } as Analysis;
}

const ROLE: RoleContext = { minYears: 5, seniority: "senior", roleFamily: "software_engineering", band: { currency: "CZK", period: "month", min: 100000, max: 150000 } };

function input(over: Partial<ProjectInput> = {}): ProjectInput {
  return { memberId: "m1", label: "Jana Nováková", membership: "applicant", runState: "done", analysisSlug: "s", analysis: analysis(), blind: false, role: ROLE, ...over };
}

const BASE = { cohortId: "c-1", status: "done" as const, jdSlug: "jd", jdTitle: "Backend", orgName: null, blind: false, reportLang: "en", createdAt: "2026-10-01T00:00:00.000Z", finishedAt: null };

const view = (inputs: Array<Partial<ProjectInput>>, role: RoleContext | null = ROLE): CohortView =>
  assembleCohortView({ ...BASE, blind: inputs.some((i) => i.blind) }, inputs.map((i) => projectCohortMember(input({ role, ...i }))), null, role);
const whyOf = (a: Analysis, role: RoleContext | null = ROLE) => view([{ analysis: a }], role).members[0].why;

const sumParts = (w: MemberDimensionWhy) => w.anatomy!.base + w.anatomy!.parts.reduce((s, p) => s + p.points, 0);
const pts = (rs: Reason[]) => rs.map((r) => r.points);

// ---- the decomposition -----------------------------------------------------------------------

test("apportion: integer parts that sum exactly to the target, each within 1 of its exact value", () => {
  assert.deepEqual(apportion([100 / 6, 100 / 6, 100 / 6, 100 / 6, 100 / 6, 100 / 6], 100), [17, 17, 17, 17, 16, 16]);
  assert.deepEqual(apportion([100 / 30, 100 / 30, 100 / 30], 10), [4, 3, 3]);
  assert.deepEqual(apportion([8.4, -6, -0], 2), [8, -6, 0]);
  assert.deepEqual(apportion([9.6, 8.4, -6], 12), [10, 8, -6]);
  assert.ok(Object.is(apportion([-0], 0)[0], 0), "never -0 on the wire");
  // Deterministic pseudo-random sweep: the sum is exact and every part is within 1.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 40 - 20;
  for (let n = 1; n < 12; n++) {
    const xs = Array.from({ length: n }, rnd);
    const target = Math.round(xs.reduce((a, b) => a + b, 0));
    const out = apportion(xs, target);
    assert.equal(out.reduce((a, b) => a + b, 0), target);
    out.forEach((v, i) => assert.ok(Number.isInteger(v) && Math.abs(v - xs[i]) < 1, `${v} vs ${xs[i]}`));
  }
});

// ---- fit ----------------------------------------------------------------------------------------

test("fit: strengths are pros, gaps and risk flags cons, alignment and must-prove notes; never a point, never an anatomy", () => {
  const w = whyOf(analysis({ jobFit: { score: 93, recruiterRiskFlags: ["Short notice."] }, gaps: ["No Oracle.", "No OpenShift."] })).fit!;
  assert.deepEqual(w.why, { key: "sentence.fit", params: { score: 93, strengths: 1, gaps: 2, risks: 1 } });
  assert.deepEqual(w.pros, [{ tone: "pro", phrase: { text: "Ships Kafka pipelines." }, source: "strengths" }]);
  assert.deepEqual(w.cons.map((r) => [r.source, r.criterionId]), [["gaps", undefined], ["gaps", undefined], ["risk", "risk"]]);
  assert.deepEqual(w.notes.map((r) => r.source), ["alignment", "alignment", "mustProve"]);
  assert.ok([...w.pros, ...w.cons, ...w.notes].every((r) => r.points === undefined));
  assert.equal(w.anatomy, undefined);
  assert.deepEqual(Object.fromEntries(Object.entries(w.criteria).map(([k, v]) => [k, v.status])), { seniority: "meets", family: "meets", risk: "misses" });
});

test("seniority: equal meets, adjacent partial, further misses, unknown off the ladder or with no target", () => {
  assert.equal(seniorityStatus("senior", "senior"), "meets");
  assert.equal(seniorityStatus("lead", "senior"), "partial");
  assert.equal(seniorityStatus("junior", "senior"), "misses");
  assert.equal(seniorityStatus("principal", "senior"), "unknown");
  assert.equal(seniorityStatus("senior", null), "unknown");
  const w = whyOf(analysis({ candidate: { roleFamily: "data_ai", currentSeniority: "medior" } }), { ...ROLE, roleFamily: null }).fit!;
  assert.equal(w.criteria.seniority.status, "partial");
  assert.equal(w.criteria.family.status, "unknown");
});

// ---- skills -------------------------------------------------------------------------------------

test("skills: one part per skill (matched 100/total, unproven 50/total, missing 0), cons carry what they cost", () => {
  const a = analysis({
    jobFit: {
      matchingSkills: ["Java", "Kafka", "Spring", "REST"],
      missingSkills: ["Oracle", "Go", "Rust"],
      unprovenSkills: ["Docker"],
      unprovenSkillReason: { docker: "Listed, but no role uses it." },
    },
  });
  const v = view([{ analysis: a }]);
  const w = v.members[0].why.skills!;
  assert.equal(v.members[0].cells.skills.rating, 56); // (4 + 0.5) / 8
  assert.equal(w.anatomy!.base, 0);
  assert.deepEqual(w.anatomy!.parts.map((p) => p.points), [13, 13, 12, 12, 6, 0, 0, 0]);
  assert.equal(sumParts(w), w.anatomy!.raw);
  assert.equal(w.anatomy!.rating, 56);
  assert.deepEqual(pts(w.pros), [13, 13, 12, 12]);
  assert.deepEqual(pts(w.cons), [-13, -13, -13]);
  assert.deepEqual(w.notes, [{ tone: "note", phrase: { key: "skill.unproven", params: { skill: "Docker" } }, source: "unproven", evidence: ["Listed, but no role uses it."], criterionId: "skill:docker" }]);
  assert.deepEqual(w.why, { key: "sentence.skills", params: { matched: 4, total: 8, unproven: 1, missing: 3, names: "Oracle, Go", more: 1 } });
  assert.deepEqual(Object.fromEntries(Object.entries(w.criteria).map(([k, c]) => [k, c.status])), {
    "skill:java": "meets", "skill:kafka": "meets", "skill:spring": "meets", "skill:rest": "meets",
    "skill:docker": "partial", "skill:oracle": "misses", "skill:go": "misses", "skill:rust": "misses",
  });
});

// ---- experience ---------------------------------------------------------------------------------

test("experience: two exact parts over 48, the points each part lost, the years against the role's minimum", () => {
  const a = analysis({ score: { total: 80, experience: 24, skills: 25, roleSeniority: 22, education: 10, traits: 5 }, evidenceTrace: { experience: ["7 years at Jana Nováková's firm"], skills: [], seniority: [], education: [], salary: [] } });
  const w = whyOf(a).experience!;
  assert.deepEqual(w.anatomy!.parts.map((p) => p.points), [50, 46]); // 24/48 = 50, 22/48 = 45.83
  assert.equal(w.anatomy!.rating, 96);
  assert.deepEqual(pts(w.pros), [50, 46]);
  assert.deepEqual(w.pros[0].evidence, ["7 years at Jana Nováková's firm"]);
  assert.deepEqual(pts(w.cons), [-2, -2]);
  assert.equal(w.criteria.minYears.status, "meets");
  assert.equal(whyOf(analysis({ candidate: { yearsExperience: 3 } })).experience!.criteria.minYears.status, "misses");
  assert.equal(whyOf(a, { ...ROLE, minYears: null }).experience!.criteria.minYears.status, "unknown");
});

// ---- signals ------------------------------------------------------------------------------------

test("signals: base 50, one part of +/-12 x confidence per signal, probes as notes, keys as criteria", () => {
  const a = analysis({
    softSignals: {
      displayName: null,
      summary: "",
      strengths: [signal("ownership", "Owns it", 0.8), signal("impact", "Numbers", 0.7)],
      antipatterns: [signal("hopping", "Short tenures", 0.5, "")],
    },
  });
  const v = view([{ analysis: a }, { memberId: "m2", analysis: analysis({ softSignals: { displayName: null, summary: "", strengths: [signal("domain", "Banking", 0.6)], antipatterns: [] } }) }]);
  const w = v.members[0].why.signals!;
  assert.equal(w.anatomy!.base, 50);
  assert.deepEqual(w.anatomy!.parts.map((p) => p.points), [10, 8, -6]); // 9.6, 8.4, -6 -> sum 12
  assert.equal(w.anatomy!.rating, v.members[0].cells.signals.rating);
  assert.deepEqual(w.why, { key: "sentence.signals", params: { strengths: 2, flags: 1, plus: 18, minus: 6 } });
  assert.equal(w.cons[0].criterionId, "signal:hopping");
  assert.equal(w.notes.length, 2, "the empty probe is not a note");
  assert.deepEqual(v.criteria.signals.map((c) => c.id), ["signal:ownership", "signal:impact", "signal:hopping", "signal:domain"]);
  assert.deepEqual(Object.values(w.criteria).map((c) => c.status), ["meets", "meets", "misses", "unknown"]);
});

// ---- trust --------------------------------------------------------------------------------------

test("trust: base 100, a part per warn (-15) and blocker (-40); a clean record says so; unread codes meet", () => {
  const f = (code: string, severity: "warn" | "blocker") => ({ code, severity, scope: "input" as const, text: `${code} found.` });
  const v = view([
    { analysis: analysis({ trustFindings: [f("date_gap", "warn"), f("duplicate_text", "blocker")] }) },
    { memberId: "m2", analysis: analysis({ trustFindings: [f("date_gap", "warn")] }) },
    { memberId: "m3", analysis: analysis({ trustFindings: [] }) },
  ]);
  const [a, b, c] = v.members.map((m) => m.why.trust!);
  assert.deepEqual(pts(a.cons), [-40, -15]);
  assert.equal(sumParts(a), 45);
  assert.deepEqual(a.pros, []);
  assert.deepEqual(b.pros.map((r) => r.phrase), [{ key: "trust.noBlockers" }]);
  assert.deepEqual(c.pros.map((r) => r.phrase), [{ key: "trust.noFindings" }]);
  assert.deepEqual(c.why, { key: "sentence.trustClean" });
  assert.deepEqual(v.criteria.trust.map((x) => x.id), ["trust:date_gap", "trust:duplicate_text"]);
  assert.deepEqual([a, b, c].map((w) => Object.values(w.criteria).map((x) => x.status)), [["partial", "misses"], ["partial", "meets"], ["meets", "meets"]]);
});

// ---- salary -------------------------------------------------------------------------------------

test("salary: inside is a pro, outside a con with its exact penalty; partial inside the soft window; notes carry the assessment", () => {
  const at = (mid: number) =>
    view([{ analysis: analysis({ salary: { currency: "CZK", period: "month", minimum: mid, maximum: mid, midpoint: mid, confidence: "m", rationale: [] } }) }]).members[0];
  const inside = at(120000).why.salary!;
  assert.deepEqual(inside.pros.map((r) => r.phrase), [{ key: "part.salaryInside", params: { basis: "band" } }]);
  assert.deepEqual(inside.notes.map((r) => r.phrase), [{ text: "Inside the band." }]);
  assert.equal(inside.criteria.band.status, "meets");
  const near = at(160000);
  assert.equal(near.cells.salary.rating, 90);
  assert.deepEqual(near.why.salary!.cons.map((r) => [r.phrase, r.points]), [[{ key: "part.salaryOutside", params: { pct: 7, direction: "above", basis: "band" } }, -10]]);
  assert.equal(near.why.salary!.criteria.band.status, "partial");
  const far = at(400000).why.salary!;
  assert.equal(far.anatomy!.raw, -150);
  assert.equal(far.anatomy!.rating, 0);
  assert.equal(far.criteria.band.status, "misses");
});

test("salary with no role band: the cohort window explains it, the criterion says so, another currency is null", () => {
  const s = (mid: number, currency = "CZK") => analysis({ salary: { currency, period: "month", minimum: mid, maximum: mid, midpoint: mid, confidence: "m", rationale: [] } });
  const v = view([{ analysis: s(110000) }, { memberId: "b", analysis: s(120000) }, { memberId: "c", analysis: s(200000) }, { memberId: "d", analysis: s(5000, "EUR") }], { ...ROLE, band: null });
  const [a, , c, d] = v.members;
  assert.deepEqual(a.why.salary!.why, { key: "sentence.salaryInside", params: { basis: "cohort" } });
  assert.equal(c.why.salary!.anatomy!.rating, c.cells.salary.rating);
  assert.equal((c.why.salary!.cons[0].phrase as { params: Record<string, unknown> }).params.basis, "cohort");
  assert.equal(d.why.salary, null);
  assert.deepEqual(v.criteria.salary, [{ id: "band", phrase: { key: "criteria.salaryCohort", params: { currency: "CZK", period: "month", tolerance: 15 } }, kind: "target" }]);
  assert.equal(v.roleBand, null);
});

// ---- public work --------------------------------------------------------------------------------

function github(over: Partial<GithubAnalysis["metrics"]> = {}, matched = ["Java", "Kafka", "SQL"], gaps = ["Oracle"]): GithubAnalysis {
  return {
    username: "jana",
    profileUrl: "https://github.com/jana",
    summary: "",
    analyzedAt: "2026-10-01T00:00:00.000Z",
    metrics: { publicRepos: 12, followers: 0, totalStars: 0, totalForks: 0, activeRepos: 5, recentlyUpdatedRepos: 0, ownedReposAnalyzed: 12, ...over },
    languages: [],
    topRepositories: [],
    contributionSignals: [],
    jobFitSignals: { jobDescriptionProvided: true, matchingSkills: matched, potentialGaps: gaps, complexityAssessment: "x" },
    limitations: [],
  };
}

test("public work: 40% skills (per skill), 30% active, 30% stars; with no JD skills 50/50; gaps and zeros are cons", () => {
  const w = publicWorkWhy(github());
  assert.deepEqual(w.anatomy!.parts.map((p) => p.points), [10, 10, 10, 0, 15, 0]); // 0.4*3/4 + 0.3*0.5 + 0 = 45
  assert.equal(w.anatomy!.rating, 45);
  assert.deepEqual(w.cons.map((r) => [r.phrase, r.points]), [[{ key: "gh.noStars" }, -30], [{ key: "gh.gap", params: { skill: "Oracle" } }, -10]]);
  const noJd = publicWorkWhy(github({ activeRepos: 10, totalStars: 1000 }, [], []));
  assert.deepEqual(noJd.anatomy!.parts.map((p) => p.points), [50, 50]);
  assert.deepEqual(noJd.why, { key: "sentence.publicWorkNoJd", params: { active: 10, stars: 1000 } });
  const link = { links: ["https://github.com/jana"] };
  const v = view([{ analysis: analysis({ candidate: link, githubDeepDive: { status: "done", analysis: github() } }) }, { memberId: "m2", analysis: analysis() }]);
  assert.deepEqual(v.criteria.publicWork.map((c) => c.id), ["gh:java", "gh:kafka", "gh:sql", "gh:oracle"]);
  assert.equal(v.members[1].why.publicWork, null, "noLink is absent, so no why");
});

// ---- the cohort ---------------------------------------------------------------------------------

test("criteria: the union of required skills across the cohort, unknown where a member's lists do not speak", () => {
  const v = view([
    { analysis: analysis({ jobFit: { matchingSkills: ["Java"], missingSkills: ["Kafka"] } }) },
    { memberId: "m2", analysis: analysis({ jobFit: { matchingSkills: ["Kafka", "Go"], missingSkills: [] } }) },
  ]);
  assert.deepEqual(v.criteria.skills.map((c) => [c.id, c.phrase, c.kind]), [["skill:java", { text: "Java" }, "must"], ["skill:kafka", { text: "Kafka" }, "must"], ["skill:go", { text: "Go" }, "must"]]);
  assert.deepEqual(v.members.map((m) => Object.values(m.why.skills!.criteria).map((c) => c.status)), [["meets", "misses", "unknown"], ["unknown", "meets", "meets"]]);
  assert.deepEqual(v.criteria.fit.map((c) => c.phrase), [
    { key: "criteria.seniority", params: { level: "senior" } },
    { key: "criteria.family", params: { family: "software engineering" } },
    { key: "criteria.risk" },
  ]);
  assert.deepEqual(v.roleBand, ROLE.band);
  const roleless = view([{ analysis: analysis() }], null);
  assert.deepEqual(roleless.criteria.experience.map((c) => c.phrase), [{ key: "criteria.minYearsNone" }, { key: "criteria.seniorityNone" }]);
  assert.equal(roleless.members[0].why.experience!.criteria.minYears.status, "unknown");
});

test("blind: no name in any text the why carries", () => {
  const a = analysis({
    strengths: ["Jana Nováková ships Kafka."],
    trustFindings: [{ code: "x", severity: "warn", scope: "identity", text: "Nováková's dates overlap." }],
    softSignals: { displayName: null, summary: "", strengths: [signal("own", "Jana owns it", 0.8, "Ask Jana about it.")], antipatterns: [] },
  });
  const v = view([{ analysis: a, blind: true }, { memberId: "m2", analysis: analysis(), blind: true }]);
  const text = JSON.stringify([v.members.map((m) => m.why), v.criteria]);
  assert.ok(!text.includes("Jana") && !text.includes("Nováková"), text);
  assert.equal(v.members[0].why.publicWork, null);
});

test("caps: six reasons, then one '+N more' carrying the dropped points; ordered by |points|", () => {
  const strengths = Array.from({ length: 9 }, (_, i) => `Strength ${i + 1}.`);
  const fit = whyOf(analysis({ strengths })).fit!;
  assert.equal(fit.pros.length, WHY_CAP + 1);
  assert.deepEqual(fit.pros.slice(0, 2).map((r) => r.phrase), [{ text: "Strength 1." }, { text: "Strength 2." }], "point-less lists keep the analysis order");
  assert.deepEqual(fit.pros[WHY_CAP], { tone: "pro", phrase: { key: "more", params: { n: 3 } }, source: "strengths" });
  const r = (points: number): Reason => ({ tone: "con", phrase: { text: String(points) }, source: "trust", points });
  const capped = capReasons([r(-1), r(-40), r(-15), r(-2), r(-3), r(-4), r(-5), r(-6)]);
  assert.deepEqual(pts(capped), [-40, -15, -6, -5, -4, -3, -3]);
  assert.deepEqual(capped[WHY_CAP].phrase, { key: "more", params: { n: 2 } });
});

test("absent -> null: no job fit nulls fit and skills, a pending member is all null, a rated cell always explains", () => {
  const v = view([{ analysis: analysis({ jobFit: null, softSignals: null }) }, { memberId: "p", analysis: null, runState: "analyzing" }]);
  const [a, p] = v.members;
  assert.equal(a.why.fit, null);
  assert.equal(a.why.skills, null);
  assert.equal(a.why.signals, null);
  assert.ok(a.why.experience && a.why.trust && a.why.salary);
  assert.ok(COHORT_DIMENSIONS.every((d) => p.why[d] === null));
  for (const d of COHORT_DIMENSIONS) assert.equal(a.why[d] === null, a.cells[d].tier === "absent", d);
});
