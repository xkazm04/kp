import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REDACTED,
  absentCell,
  assembleCohortView,
  bandDrivers,
  makeRedactor,
  projectCohortMember,
  rateAgainstRange,
  tierOf,
  type ProjectInput,
  type ProjectedMember,
} from "./cohortProject.ts";
import { ABSENT_REASONS, COHORT_DIMENSIONS, type AbsentReason, type RoleBand } from "./cohortTypes.ts";
// Type-only (erased by the strip-only runner) so this file stays dependency-free.
import type { Analysis, GithubAnalysis } from "../../../../_lib/schemas.ts";

type DeepPartialAnalysis = Partial<Omit<Analysis, "candidate" | "jobFit">> & {
  candidate?: Partial<Analysis["candidate"]>;
  jobFit?: Partial<NonNullable<Analysis["jobFit"]>> | null;
};

/** A minimal, valid Analysis: a model-scored senior engineer with a clean record. */
function makeAnalysis(over: DeepPartialAnalysis = {}): Analysis {
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
      evidence: ["Backend Engineer, Jana Nováková & Co."],
      links: [],
      ...candidate,
    },
    score: { total: 80, experience: 20, skills: 25, roleSeniority: 20, education: 10, traits: 5 },
    salary: { currency: "CZK", period: "month", minimum: 100000, maximum: 140000, midpoint: 120000, confidence: "medium", rationale: [] },
    strengths: [],
    gaps: [],
    recommendations: [],
    explanation: "",
    sanityChecks: [],
    trustFindings: [],
    jobFit:
      jobFit === null
        ? null
        : {
            score: 70,
            summary: "Jana Nováková is a solid fit (70/100).",
            matchingSkills: ["Java", "Kafka"],
            missingSkills: [],
            seniorityAlignment: "Senior matches.",
            roleAlignment: "Same family.",
            salaryAssessment: "",
            recommendations: [],
            interviewTalkingPoints: [],
            cvRewriteSuggestions: [],
            mustProveEvidence: [],
            negotiationAngle: "",
            recruiterRiskFlags: [],
            ...jobFit,
          },
    metadata: { analysisEngine: "gemini", textExtractor: "pypdf", engineKind: "llm", parsingNotes: [], groundingSources: [] },
    softSignals: { displayName: null, strengths: [], antipatterns: [], summary: "" },
    ...rest,
  } as Analysis;
}

function input(over: Partial<ProjectInput> = {}): ProjectInput {
  return {
    memberId: "m1",
    label: "Jana Nováková",
    membership: "applicant",
    runState: "done",
    analysisSlug: "slug-1",
    analysis: makeAnalysis(),
    blind: false,
    role: null,
    ...over,
  };
}

const BASE = {
  cohortId: "c-1",
  status: "done" as const,
  jdSlug: "jd",
  jdTitle: "Backend",
  orgName: null,
  blind: false,
  reportLang: "en",
  createdAt: "2026-10-01T00:00:00.000Z",
  finishedAt: null,
};

const finding = (severity: "warn" | "blocker") => ({ code: "x", severity, scope: "input" as const, text: "t" });

function github(over: Partial<GithubAnalysis["metrics"]> = {}, matched = ["Java", "Kafka", "SQL"], gaps = ["Oracle"]): GithubAnalysis {
  return {
    username: "jana",
    profileUrl: "https://github.com/jana",
    summary: "",
    analyzedAt: "2026-10-01T00:00:00.000Z",
    metrics: { publicRepos: 12, followers: 0, totalStars: 0, totalForks: 0, activeRepos: 5, recentlyUpdatedRepos: 0, ownedReposAnalyzed: 12, ...over },
    languages: [{ name: "Java", bytes: 10, percent: 80 }],
    topRepositories: [],
    contributionSignals: [],
    jobFitSignals: { jobDescriptionProvided: true, matchingSkills: matched, potentialGaps: gaps, complexityAssessment: "x" },
    limitations: [],
  };
}

// ---- absence --------------------------------------------------------------------------

test("no analysis yet: every cell is pending, every detail null", () => {
  const m = projectCohortMember(input({ analysis: null, runState: "analyzing", analysisSlug: null }));
  for (const d of COHORT_DIMENSIONS) {
    assert.equal(m.cells[d].tier, "absent");
    assert.equal(m.cells[d].absentReason, "pending");
    assert.equal(m.cells[d].rating, null);
    assert.equal(m.detail[d], null);
  }
  assert.equal(m.roleFamily, null);
});

test("a failed run is failed on every cell; a done run with no readable analysis is notRead", () => {
  const failed = projectCohortMember(input({ analysis: null, runState: "failed" }));
  assert.ok(COHORT_DIMENSIONS.every((d) => failed.cells[d].absentReason === "failed"));
  const lost = projectCohortMember(input({ analysis: null, runState: "done" }));
  assert.ok(COHORT_DIMENSIONS.every((d) => lost.cells[d].absentReason === "notRead"));
});

test("no job fit: fit and skills are noJdFit, the fit detail keeps the score total", () => {
  const m = projectCohortMember(input({ analysis: makeAnalysis({ jobFit: null }) }));
  assert.equal(m.cells.fit.absentReason, "noJdFit");
  assert.equal(m.cells.skills.absentReason, "noJdFit");
  assert.equal(m.cells.fit.band, undefined);
  assert.equal(m.detail.fit?.jobFitScore, null);
  assert.equal(m.detail.fit?.total, 80);
  assert.equal(m.detail.skills, null);
});

test("unread soft signals and trust findings are notRead, never 0 and never clean", () => {
  const m = projectCohortMember(input({ analysis: makeAnalysis({ softSignals: null, trustFindings: null }) }));
  assert.equal(m.cells.signals.absentReason, "notRead");
  assert.equal(m.cells.trust.absentReason, "notRead");
  assert.equal(m.detail.signals, null);
  assert.equal(m.detail.trust, null);
});

test("every absent cell carries a reason from the contract and no rating", () => {
  const cell = absentCell("fit", "blind");
  assert.equal(cell.rating, null);
  assert.ok((ABSENT_REASONS as readonly AbsentReason[]).includes(cell.absentReason!));
  assert.equal(cell.label.key, "none");
});

// ---- tiers and the fit band ---------------------------------------------------------------

test("tier boundaries: 75 strong, 55 solid, 35 thin, below weak", () => {
  assert.equal(tierOf(100), "strong");
  assert.equal(tierOf(75), "strong");
  assert.equal(tierOf(74), "solid");
  assert.equal(tierOf(55), "solid");
  assert.equal(tierOf(54), "thin");
  assert.equal(tierOf(35), "thin");
  assert.equal(tierOf(34), "weak");
  assert.equal(tierOf(0), "weak");
});

test("a clean model-scored record gets the base band of +/-5 and no drivers", () => {
  const m = projectCohortMember(input());
  assert.deepEqual(m.cells.fit.band, { lo: 65, hi: 75, drivers: [] });
  assert.equal(m.cells.fit.tier, "solid");
  assert.deepEqual(m.cells.fit.label, { key: "cells.fit", params: { score: 70 } });
});

test("each named driver widens the band by its own increment", () => {
  const width = (a: Analysis) => bandDrivers(a).width;
  assert.equal(width(makeAnalysis({ candidate: { skills: ["Java"] } })), 9);
  assert.equal(width(makeAnalysis({ candidate: { educationLevel: "unknown" } })), 8);
  assert.equal(width(makeAnalysis({ jobFit: { missingSkills: ["a", "b", "c"] } })), 9);
  assert.equal(width(makeAnalysis({ trustFindings: [finding("warn")] })), 8);
  assert.equal(width(makeAnalysis({ trustFindings: [finding("blocker")] })), 13);
  assert.equal(width(makeAnalysis({ metadata: { analysisEngine: "seed-deterministic", textExtractor: "", parsingNotes: [], groundingSources: [] } })), 10);
  const keys = bandDrivers(makeAnalysis({ candidate: { skills: [], educationLevel: "" }, trustFindings: [finding("warn"), finding("blocker")] })).drivers.map((d) => d.key);
  assert.deepEqual(keys, ["drivers.fewSkills", "drivers.educationUnknown", "drivers.trustWarn", "drivers.trustBlocker"]);
});

test("trust warnings widen by 3 each up to 9, and the band is clamped to 0..100", () => {
  const four = makeAnalysis({ trustFindings: [finding("warn"), finding("warn"), finding("warn"), finding("warn")] });
  assert.equal(bandDrivers(four).width, 14);
  assert.deepEqual(bandDrivers(four).drivers.find((d) => d.key === "drivers.trustWarn")?.params, { n: 4 });
  const high = projectCohortMember(input({ analysis: makeAnalysis({ jobFit: { score: 98 }, trustFindings: [finding("blocker")] }) }));
  assert.equal(high.cells.fit.band?.hi, 100);
  assert.equal(high.cells.fit.band?.lo, 85);
  const low = projectCohortMember(input({ analysis: makeAnalysis({ jobFit: { score: 3 } }) }));
  assert.equal(low.cells.fit.band?.lo, 0);
});

// ---- the other ratings --------------------------------------------------------------------

test("skills: unproven counts half and is split out of matched/missing", () => {
  const a = makeAnalysis({ candidate: { skills: ["Java", "Kafka", "Go"] }, jobFit: { matchingSkills: ["Java", "Kafka", "Spring"], missingSkills: ["Oracle"], unprovenSkills: ["spring"] } });
  const m = projectCohortMember(input({ analysis: a }));
  assert.equal(m.cells.skills.rating, 63); // (2 + 0.5) / 4
  assert.deepEqual(m.cells.skills.label, { key: "cells.skillsUnproven", params: { matched: 2, total: 4, unproven: 1 } });
  assert.deepEqual(m.detail.skills, { dimension: "skills", matched: ["Java", "Kafka"], missing: ["Oracle"], unproven: ["spring"], extra: ["Go"] });
  const empty = projectCohortMember(input({ analysis: makeAnalysis({ jobFit: { matchingSkills: [], missingSkills: [] } }) }));
  assert.equal(empty.cells.skills.absentReason, "noJdFit");
});

test("experience, signals and trust follow their stated formulas", () => {
  const a = makeAnalysis({
    score: { total: 90, experience: 25, skills: 20, roleSeniority: 23, education: 12, traits: 10 },
    softSignals: {
      displayName: null,
      summary: "",
      strengths: [0.8, 0.7].map((c) => ({ key: "s", kind: "k", label: "Owns it", detail: "d", evidence: [], confidence: c, source: "cv", needsConfirmation: true, suggestedProbe: "p" })),
      antipatterns: [{ key: "a", kind: "k", label: "Hops", detail: "d", evidence: [], confidence: 0.5, source: "cv", needsConfirmation: true, suggestedProbe: "" }],
    },
    trustFindings: [finding("warn"), finding("blocker")],
  });
  const m = projectCohortMember(input({ analysis: a }));
  assert.equal(m.cells.experience.rating, 100);
  assert.deepEqual(m.cells.experience.label, { key: "cells.experience", params: { years: 7, seniority: "senior" } });
  assert.equal(m.cells.signals.rating, 62); // 50 + 12 * (1.5 - 0.5)
  assert.deepEqual(m.cells.signals.label.params, { strengths: 2, flags: 1 });
  assert.equal(m.detail.signals?.antipatterns[0].probe, null);
  assert.equal(m.cells.trust.rating, 45); // 100 - 15 - 40
  assert.deepEqual(m.cells.trust.label, { key: "cells.trustFlags", params: { n: 2 } });
  assert.deepEqual(projectCohortMember(input()).cells.trust.label, { key: "cells.trustClean" });
});

// ---- salary --------------------------------------------------------------------------------

const BAND: RoleBand = { currency: "CZK", period: "month", min: 100000, max: 150000 };
const withSalary = (midpoint: number, currency = "CZK", period = "month") =>
  makeAnalysis({ salary: { currency, period, minimum: midpoint, maximum: midpoint, midpoint, confidence: "medium", rationale: [] } });

test("rateAgainstRange: 100 inside, falling 150 points per unit of relative distance outside", () => {
  assert.equal(rateAgainstRange(100000, 100000, 150000), 100);
  assert.equal(rateAgainstRange(150000, 100000, 150000), 100);
  assert.equal(rateAgainstRange(165000, 100000, 150000), 85);
  assert.equal(rateAgainstRange(90000, 100000, 150000), 85);
  assert.equal(rateAgainstRange(50000, 100000, 150000), 25);
  assert.equal(rateAgainstRange(400000, 100000, 150000), 0);
  assert.equal(rateAgainstRange(999999, 100000, null), 100);
});

test("salary against the band: inside, outside, and another currency or pay basis refused", () => {
  const rate = (a: Analysis) => projectCohortMember(input({ analysis: a, role: { minYears: null, seniority: null, roleFamily: null, band: BAND } })).cells.salary;
  assert.equal(rate(withSalary(120000)).rating, 100);
  assert.equal(rate(withSalary(165000)).rating, 85);
  const eur = rate(withSalary(5000, "EUR"));
  assert.equal(eur.absentReason, "currencyMismatch");
  assert.deepEqual(eur.label, { key: "cells.salaryBand", params: { midpoint: 5000, currency: "EUR", period: "month" } });
  assert.equal(rate(withSalary(1500000, "CZK", "year")).absentReason, "currencyMismatch");
});

test("no band: the cohort's majority currency is rated against its median, the rest refused", () => {
  const mk = (id: string, mid: number, currency = "CZK"): ProjectedMember => projectCohortMember(input({ memberId: id, analysis: withSalary(mid, currency) }));
  const pending = mk("a", 100000);
  assert.equal(pending.cells.salary.absentReason, "pending");
  assert.equal(pending.cells.salary.label.key, "cells.salaryCohort");
  const view = assembleCohortView(BASE, [mk("a", 110000), mk("b", 120000), mk("c", 200000), mk("d", 5000, "EUR")], null);
  const s = Object.fromEntries(view.members.map((m) => [m.memberId, m.cells.salary]));
  // CZK median 120000, window 102000..138000
  assert.equal(s.a.rating, 100);
  assert.equal(s.b.rating, 100);
  assert.equal(s.c.rating, 33); // 45% above the window's top
  assert.equal(s.c.tier, "weak");
  assert.equal(s.d.absentReason, "currencyMismatch");
  assert.equal(view.claims.byDimension.salary.leader, null);
  assert.deepEqual(view.claims.byDimension.salary.partitions?.map((p) => p.key), ["CZK/month", "EUR/month"]);
});

// ---- public work ---------------------------------------------------------------------------

test("public work: blind, notTechnical, noLink, notRead, failed and done each take their path", () => {
  const pw = (over: DeepPartialAnalysis, blind = false) => projectCohortMember(input({ analysis: makeAnalysis(over), blind })).cells.publicWork;
  const link = { links: ["https://www.linkedin.com/in/jana", "https://github.com/jana"] };
  assert.equal(pw({ candidate: link }, true).absentReason, "blind");
  assert.equal(pw({ candidate: { ...link, roleFamily: "sales_marketing" } }).absentReason, "notTechnical");
  assert.equal(pw({ candidate: { links: ["https://www.linkedin.com/in/jana"] } }).absentReason, "noLink");
  assert.equal(pw({ candidate: link }).absentReason, "notRead");
  assert.equal(pw({ candidate: link, githubDeepDive: { status: "skipped", reason: "blind" } }).absentReason, "notRead");
  assert.equal(pw({ candidate: link, githubDeepDive: { status: "error", code: "RATE_LIMITED" } }).absentReason, "failed");
  const done = pw({ candidate: link, githubDeepDive: { status: "done", analysis: github() } });
  assert.equal(done.rating, 45); // 0.4 * 3/4 + 0.3 * 5/10 + 0.3 * 0
  assert.deepEqual(done.label, { key: "cells.publicWork", params: { repos: 12, language: "Java" } });
  const stars = pw({ candidate: link, githubDeepDive: { status: "done", analysis: github({ totalStars: 1000, activeRepos: 20 }, ["Java"], []) } });
  assert.equal(stars.rating, 100);
});

// ---- blind ----------------------------------------------------------------------------------

test("makeRedactor replaces the name and its parts as whole words only", () => {
  const r = makeRedactor("Jan Novák");
  assert.equal(r("Jan Novák led it; Novák again. January and Janet stay."), `${REDACTED} led it; ${REDACTED} again. January and Janet stay.`);
  assert.equal(makeRedactor(null)("Jan"), "Jan");
});

test("blind hides public work and keeps the name out of every detail string", () => {
  const a = makeAnalysis({
    candidate: { links: ["https://github.com/jana"] },
    githubDeepDive: { status: "done", analysis: github() },
    trustFindings: [{ code: "x", severity: "warn", scope: "identity", text: "Jana Nováková's dates overlap." }],
  });
  const m = projectCohortMember(input({ analysis: a, blind: true }));
  assert.equal(m.cells.publicWork.absentReason, "blind");
  assert.equal(m.detail.publicWork, null);
  const text = JSON.stringify(m.detail);
  assert.ok(!text.includes("Jana") && !text.includes("Nováková"), text);
  const view = assembleCohortView({ ...BASE, blind: true }, [m, projectCohortMember(input({ memberId: "m2", analysis: makeAnalysis(), blind: true }))], null);
  assert.deepEqual(view.members.map((x) => x.label).sort(), ["Candidate A", "Candidate B"]);
});

// ---- the view -------------------------------------------------------------------------------

test("assembleCohortView: progress, comments on rated cells only, notes, narrative", () => {
  const members = [
    projectCohortMember(input({ memberId: "a", runState: "done" })),
    projectCohortMember(input({ memberId: "b", runState: "reused", analysis: makeAnalysis({ softSignals: null }) })),
    projectCohortMember(input({ memberId: "c", runState: "failed", analysis: null })),
    projectCohortMember(input({ memberId: "d", runState: "queued", analysis: null })),
  ];
  const view = assembleCohortView(BASE, members, {
    cells: [
      { memberId: "a", dimension: "fit", comment: " Strong on Kafka. " },
      { memberId: "b", dimension: "signals", comment: "should be dropped: the cell is absent" },
      { memberId: "zz", dimension: "fit", comment: "unknown member" },
    ],
    notes: { fit: "Close at the top.", skills: "  " },
    narrative: { covers: ["a", "b", "ghost"], leavesOut: 2, text: "Both cover the core.", engine: "model" },
  });
  assert.deepEqual(view.progress, { total: 4, done: 2, reused: 1, failed: 1 });
  const byId = Object.fromEntries(view.members.map((m) => [m.memberId, m]));
  assert.equal(byId.a.cells.fit.comment, "Strong on Kafka.");
  assert.equal(byId.b.cells.signals.comment, undefined);
  assert.equal(view.claims.byDimension.fit.note, "Close at the top.");
  assert.equal(view.claims.byDimension.skills.note, undefined);
  assert.deepEqual(view.narrative?.covers, ["a", "b"]);
  assert.equal(byId.c.fitRank, null);
  assert.deepEqual(view.members.map((m) => m.neutralIndex).sort(), [0, 1, 2, 3]);
});

test("assembleCohortView drops the narrative below the head-to-head floor", () => {
  const view = assembleCohortView(BASE, [projectCohortMember(input())], {
    cells: [],
    notes: {},
    narrative: { covers: ["m1"], leavesOut: 0, text: "Only one.", engine: "keyless" },
  });
  assert.equal(view.narrative, null);
  assert.equal(view.claims.byDimension.fit.separation, "belowFloor");
});
