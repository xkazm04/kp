// Cohort engine, the why: pros, cons, notes, the score anatomy and the role's criteria for
// every rated cell (spark analyze-v2-cohort, round 2).
//
// Operator's words: "We can't just show the numeric scores between each other - we need
// comparison tables or structure with pros and cons per candidate to understand briefly why
// scores are on these levels." Operator's decision: everything here is assembled
// DETERMINISTICALLY from fields every analysis already has. Nothing is newly written by a
// model; analysis prose (a strength, an alignment sentence) is carried verbatim as `text`
// (redacted in a blind cohort), and every code-made word is a key under analyzeCohort.why.
//
// Points: present only where the rating is a code formula (cohortFormula.ts), never on fit
// (model-given). The anatomy's integer parts sum EXACTLY to the rounded rating
// (largest-remainder apportionment), so base + sum(parts) === raw and clamp(raw) === rating.
//
// CLIENT-SAFE and pure: type-only imports plus the formulas and the wire contract.
import type { Analysis, GithubAnalysis } from "../../../../_lib/schemas.ts";
import { COHORT_DIMENSIONS } from "./cohortTypes.ts";
import type {
  CohortCell,
  CohortDimension,
  CohortMember,
  CriterionStatus,
  DimensionCriterion,
  MemberDimensionWhy,
  Phrase,
  Reason,
  ReasonSource,
  ReasonTone,
  RoleBand,
  RoleContext,
  ScoreAnatomy,
} from "./cohortTypes.ts";
import {
  EXPERIENCE_MAX,
  EXPERIENCE_SCALE,
  PUBLIC_WORK_WEIGHTS,
  SALARY_BASE,
  SALARY_SLOPE,
  SALARY_SOFT_WINDOW,
  SIGNALS_BASE,
  SIGNAL_WEIGHT,
  TRUST_BASE,
  TRUST_PENALTY,
  UNPROVEN_SHARE,
  apportion,
  clampRating,
  confidenceOf,
  experienceRaw,
  norm,
  publicWorkFactors,
  publicWorkRaw,
  salaryDistance,
  salaryRaw,
  signalsRaw,
  skillSets,
  skillsRaw,
  trustRaw,
} from "./cohortFormula.ts";

export type Redact = (text: string) => string;
type Why = MemberDimensionWhy;
type WhyMap = CohortMember["why"];

/** The longest pros / cons / notes list; the rest fold into one "+N more" reason. */
export const WHY_CAP = 6;
/** The seniority ladder candidates and roles share (pipeline/jobfit/jobs.py SENIORITIES). */
export const SENIORITY_LADDER = ["junior", "medior", "senior", "lead"] as const;
/** How many missing skills the skills sentence names before it counts the rest. */
const NAMED_MISSING = 2;

const oneDecimal = (n: number): number => Math.round(n * 10) / 10;
const sum = (ns: readonly number[]): number => ns.reduce((a, b) => a + b, 0);

/** Non-empty analysis prose, trimmed and redacted, in the analysis's order. */
const texts = (list: ReadonlyArray<string | null | undefined> | null | undefined, r: Redact): string[] =>
  (list ?? []).map((t) => (t ?? "").trim()).filter(Boolean).map(r);

function reason(
  tone: ReasonTone,
  phrase: Phrase,
  source: ReasonSource,
  extra: { points?: number; evidence?: string[]; criterionId?: string } = {}
): Reason {
  const out: Reason = { tone, phrase, source };
  if (extra.points !== undefined) out.points = extra.points;
  if (extra.evidence?.length) out.evidence = extra.evidence;
  if (extra.criterionId) out.criterionId = extra.criterionId;
  return out;
}

/**
 * Order by |points| (largest first) where points exist, then the point-less reasons in the
 * analysis's own order; keep WHY_CAP and fold the rest into "+N more", which carries the
 * dropped points' sum when they had any (so a ledger still adds up).
 */
export function capReasons(list: Reason[]): Reason[] {
  const ranked = list
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const pa = a.r.points;
      const pb = b.r.points;
      if (pa !== undefined && pb !== undefined) return Math.abs(pb) - Math.abs(pa) || a.i - b.i;
      if (pa !== undefined) return -1;
      if (pb !== undefined) return 1;
      return a.i - b.i;
    })
    .map((x) => x.r);
  if (ranked.length <= WHY_CAP) return ranked;
  const dropped = ranked.slice(WHY_CAP);
  const scored = dropped.filter((r) => r.points !== undefined);
  const more = reason(
    dropped[0].tone,
    { key: "more", params: { n: dropped.length } },
    dropped[0].source,
    scored.length ? { points: sum(scored.map((r) => r.points!)) } : {}
  );
  return [...ranked.slice(0, WHY_CAP), more];
}

interface PartSpec {
  phrase: Phrase;
  exact: number;
  tone: ReasonTone;
}

/** The exact integer decomposition of a formula float: base + sum(parts) === raw === round(float). */
export function anatomyOf(base: number, parts: PartSpec[], rawFloat: number): ScoreAnatomy {
  const points = apportion(
    parts.map((p) => p.exact),
    Math.round(rawFloat) - base
  );
  const raw = base + sum(points);
  return { base, parts: parts.map((p, i) => ({ phrase: p.phrase, points: points[i], tone: p.tone })), raw, rating: clampRating(raw) };
}

function why(sentence: Phrase, lists: { pros?: Reason[]; cons?: Reason[]; notes?: Reason[] }, criteria: Why["criteria"], anatomy?: ScoreAnatomy): Why {
  const out: Why = { why: sentence, pros: capReasons(lists.pros ?? []), cons: capReasons(lists.cons ?? []), notes: capReasons(lists.notes ?? []), criteria };
  if (anatomy) out.anatomy = anatomy;
  return out;
}

const withNote = (status: CriterionStatus, text?: string): Why["criteria"][string] => (text ? { status, note: { text } } : { status });

// ---- criteria statuses -----------------------------------------------------------------

export const skillCriterionId = (skill: string): string => `skill:${norm(skill)}`;
export const githubCriterionId = (skill: string): string => `gh:${norm(skill)}`;
export const trustCriterionId = (code: string): string => `trust:${code.trim()}`;
const signalKey = (s: { key: string; label: string }): string => s.key.trim() || norm(s.label);
export const signalCriterionId = (s: { key: string; label: string }): string => `signal:${signalKey(s)}`;

/** Equal level meets, an adjacent one is partial, further misses; unknown when either side is not on the ladder. */
export function seniorityStatus(candidate: string | null | undefined, target: string | null | undefined): CriterionStatus {
  const ladder = SENIORITY_LADDER as readonly string[];
  const c = ladder.indexOf(norm(candidate ?? ""));
  const t = ladder.indexOf(norm(target ?? ""));
  if (c < 0 || t < 0) return "unknown";
  const d = Math.abs(c - t);
  return d === 0 ? "meets" : d === 1 ? "partial" : "misses";
}

function familyStatus(candidate: string | null | undefined, target: string | null | undefined): CriterionStatus {
  const c = norm(candidate ?? "");
  const t = norm(target ?? "");
  if (!c || !t) return "unknown";
  return c === t ? "meets" : "misses";
}

// ---- fit (model-given: no points, no anatomy) --------------------------------------------

export function fitWhy(a: Analysis, r: Redact, role: RoleContext | null): Why | null {
  const jf = a.jobFit;
  if (!jf) return null;
  const strengths = texts(a.strengths, r);
  const gaps = texts(a.gaps, r);
  const risks = texts(jf.recruiterRiskFlags, r);
  const [seniorityText] = texts([jf.seniorityAlignment], r);
  const [roleText] = texts([jf.roleAlignment], r);
  const notes: Reason[] = [];
  if (seniorityText) notes.push(reason("note", { text: seniorityText }, "alignment", { criterionId: "seniority" }));
  if (roleText) notes.push(reason("note", { text: roleText }, "alignment", { criterionId: "family" }));
  for (const t of texts(jf.mustProveEvidence, r)) notes.push(reason("note", { text: t }, "mustProve"));
  return why(
    { key: "sentence.fit", params: { score: clampRating(jf.score), strengths: strengths.length, gaps: gaps.length, risks: risks.length } },
    {
      // Overall strengths/gaps are untagged by dimension, so they live under fit only.
      pros: strengths.map((t) => reason("pro", { text: t }, "strengths")),
      cons: [...gaps.map((t) => reason("con", { text: t }, "gaps")), ...risks.map((t) => reason("con", { text: t }, "risk", { criterionId: "risk" }))],
      notes,
    },
    {
      seniority: withNote(seniorityStatus(a.candidate.currentSeniority, role?.seniority), seniorityText),
      family: withNote(familyStatus(a.candidate.roleFamily, role?.roleFamily), roleText),
      risk: { status: risks.length ? "misses" : "meets" },
    }
  );
}

// ---- skills ----------------------------------------------------------------------------

function unprovenReason(a: Analysis, skill: string): string | undefined {
  const reasons = a.jobFit?.unprovenSkillReason ?? {};
  if (reasons[skill]) return reasons[skill];
  const hit = Object.keys(reasons).find((k) => norm(k) === norm(skill));
  return hit ? reasons[hit] : undefined;
}

export function skillsWhy(a: Analysis, r: Redact): Why | null {
  const sets = skillSets(a);
  const rawFloat = sets ? skillsRaw(sets) : null;
  if (!sets || rawFloat === null) return null;
  const total = sets.matched.length + sets.unproven.length + sets.missing.length;
  const matchedPhrase = (skill: string): Phrase => ({ key: "skill.matched", params: { skill } });
  const unprovenPhrase = (skill: string): Phrase => ({ key: "skill.unproven", params: { skill } });
  const missingPhrase = (skill: string): Phrase => ({ key: "skill.missing", params: { skill } });
  const an = anatomyOf(0, [
    ...sets.matched.map((s) => ({ phrase: matchedPhrase(s), exact: 100 / total, tone: "pro" as const })),
    ...sets.unproven.map((s) => ({ phrase: unprovenPhrase(s), exact: (UNPROVEN_SHARE * 100) / total, tone: "note" as const })),
    ...sets.missing.map((s) => ({ phrase: missingPhrase(s), exact: 0, tone: "con" as const })),
  ], rawFloat);
  // A missing skill earns 0; its reason carries what it cost against a full match.
  const cost = -Math.round(100 / total);
  const criteria: Why["criteria"] = {};
  for (const s of sets.matched) criteria[skillCriterionId(s)] = { status: "meets" };
  for (const s of sets.unproven) criteria[skillCriterionId(s)] = { status: "partial" };
  for (const s of sets.missing) criteria[skillCriterionId(s)] = { status: "misses" };
  return why(
    {
      key: "sentence.skills",
      params: {
        matched: sets.matched.length,
        total,
        unproven: sets.unproven.length,
        missing: sets.missing.length,
        names: sets.missing.slice(0, NAMED_MISSING).join(", "),
        more: Math.max(0, sets.missing.length - NAMED_MISSING),
      },
    },
    {
      pros: sets.matched.map((s, i) => reason("pro", matchedPhrase(s), "skills", { points: an.parts[i].points, criterionId: skillCriterionId(s) })),
      cons: sets.missing.map((s) => reason("con", missingPhrase(s), "skills", { points: cost, criterionId: skillCriterionId(s) })),
      notes: sets.unproven.map((s) =>
        reason("note", unprovenPhrase(s), "unproven", { evidence: texts([unprovenReason(a, s)], r), criterionId: skillCriterionId(s) })
      ),
    },
    criteria,
    an
  );
}

// ---- experience --------------------------------------------------------------------------

export function experienceWhy(a: Analysis, r: Redact, role: RoleContext | null): Why {
  const s = a.score;
  const years = a.candidate.yearsExperience;
  const seniority = a.candidate.currentSeniority?.trim() || "unknown";
  const expPhrase: Phrase = { key: "part.experience", params: { score: s.experience, max: EXPERIENCE_MAX.experience } };
  const levelPhrase: Phrase = { key: "part.roleSeniority", params: { score: s.roleSeniority, max: EXPERIENCE_MAX.roleSeniority } };
  const an = anatomyOf(0, [
    { phrase: expPhrase, exact: (s.experience * 100) / EXPERIENCE_SCALE, tone: "pro" },
    { phrase: levelPhrase, exact: (s.roleSeniority * 100) / EXPERIENCE_SCALE, tone: "pro" },
  ], experienceRaw(s));
  const [expPts, levelPts] = an.parts.map((p) => p.points);
  const lostExp = Math.round(((EXPERIENCE_MAX.experience - s.experience) * 100) / EXPERIENCE_SCALE);
  const lostLevel = Math.round(((EXPERIENCE_MAX.roleSeniority - s.roleSeniority) * 100) / EXPERIENCE_SCALE);
  const pros: Reason[] = [];
  if (expPts > 0)
    pros.push(reason("pro", { key: "exp.years", params: { years: oneDecimal(years) } }, "evidenceTrace", { points: expPts, evidence: texts(a.evidenceTrace?.experience, r), criterionId: "minYears" }));
  if (levelPts > 0)
    pros.push(reason("pro", { key: "exp.level", params: { seniority } }, "scoreParts", { points: levelPts, evidence: texts(a.evidenceTrace?.seniority, r), criterionId: "seniority" }));
  const cons: Reason[] = [];
  if (lostExp > 0) cons.push(reason("con", expPhrase, "scoreParts", { points: -lostExp, criterionId: "minYears" }));
  if (lostLevel > 0) cons.push(reason("con", levelPhrase, "scoreParts", { points: -lostLevel, criterionId: "seniority" }));
  const [seniorityText] = texts([a.jobFit?.seniorityAlignment], r);
  const min = role?.minYears ?? null;
  return why(
    {
      key: "sentence.experience",
      params: {
        years: oneDecimal(years),
        experience: s.experience,
        experienceMax: EXPERIENCE_MAX.experience,
        roleSeniority: s.roleSeniority,
        roleSeniorityMax: EXPERIENCE_MAX.roleSeniority,
      },
    },
    { pros, cons, notes: seniorityText ? [reason("note", { text: seniorityText }, "alignment", { criterionId: "seniority" })] : [] },
    {
      minYears: { status: min === null || !Number.isFinite(years) ? "unknown" : years >= min ? "meets" : "misses" },
      seniority: withNote(seniorityStatus(a.candidate.currentSeniority, role?.seniority), seniorityText),
    },
    an
  );
}

// ---- signals -------------------------------------------------------------------------------

export function signalsWhy(a: Analysis, r: Redact): Why | null {
  const ss = a.softSignals;
  if (!ss) return null;
  const items = [...ss.strengths.map((s) => ({ s, sign: 1 })), ...ss.antipatterns.map((s) => ({ s, sign: -1 }))];
  const an = anatomyOf(
    SIGNALS_BASE,
    items.map(({ s, sign }) => ({ phrase: { text: r(s.label) }, exact: sign * SIGNAL_WEIGHT * confidenceOf(s.confidence), tone: sign > 0 ? "pro" : "con" })),
    signalsRaw(ss)
  );
  const reasons = items.map(({ s, sign }, i) =>
    reason(sign > 0 ? "pro" : "con", { text: r(s.label) }, "softSignal", {
      points: an.parts[i].points,
      evidence: texts([s.detail, ...(s.evidence ?? [])], r),
      criterionId: signalCriterionId(s),
    })
  );
  const criteria: Why["criteria"] = {};
  for (const { s, sign } of items) {
    const id = signalCriterionId(s);
    // Shown both ways (a strength AND a flag on one key) reads as partial.
    const status: CriterionStatus = sign > 0 ? "meets" : criteria[id]?.status === "meets" ? "partial" : "misses";
    criteria[id] = { status, note: { text: r(s.label) } };
  }
  const points = an.parts.map((p) => p.points);
  return why(
    {
      key: "sentence.signals",
      params: { strengths: ss.strengths.length, flags: ss.antipatterns.length, plus: sum(points.filter((p) => p > 0)), minus: -sum(points.filter((p) => p < 0)) },
    },
    {
      pros: reasons.filter((x) => x.tone === "pro"),
      cons: reasons.filter((x) => x.tone === "con"),
      notes: items
        .filter(({ s }) => s.suggestedProbe?.trim())
        .map(({ s }) => reason("note", { text: r(s.suggestedProbe.trim()) }, "softSignal", { criterionId: signalCriterionId(s) })),
    },
    criteria,
    an
  );
}

// ---- trust -----------------------------------------------------------------------------------

export function trustWhy(a: Analysis, r: Redact): Why | null {
  const findings = a.trustFindings;
  if (!findings) return null;
  const flagged = findings.filter((f): f is typeof f & { severity: "warn" | "blocker" } => f.severity === "warn" || f.severity === "blocker");
  const an = anatomyOf(
    TRUST_BASE,
    flagged.map((f) => ({ phrase: { text: r(f.text) }, exact: -TRUST_PENALTY[f.severity], tone: "con" as const })),
    trustRaw(findings)
  );
  const blockers = flagged.filter((f) => f.severity === "blocker").length;
  const criteria: Why["criteria"] = {};
  for (const f of flagged) {
    const id = trustCriterionId(f.code);
    if (criteria[id]?.status === "misses") continue;
    criteria[id] = { status: f.severity === "blocker" ? "misses" : "partial", note: { text: r(f.text) } };
  }
  return why(
    flagged.length ? { key: "sentence.trust", params: { warns: flagged.length - blockers, blockers } } : { key: "sentence.trustClean" },
    {
      pros: flagged.length === 0 ? [reason("pro", { key: "trust.noFindings" }, "trust")] : blockers === 0 ? [reason("pro", { key: "trust.noBlockers" }, "trust")] : [],
      cons: flagged.map((f, i) => reason("con", { text: r(f.text) }, "trust", { points: an.parts[i].points, evidence: texts([f.value], r), criterionId: trustCriterionId(f.code) })),
    },
    criteria,
    an
  );
}

// ---- salary ----------------------------------------------------------------------------------

/** What a salary is rated against: the role's band, or the cohort's majority-currency median window. */
export interface SalaryBasis {
  kind: "band" | "cohort";
  min: number | null;
  max: number | null;
}

/** jobFit.salaryAssessment as a note (the only salary prose the analysis carries per role). */
export function salaryNotes(a: Analysis, r: Redact): Reason[] {
  return texts([a.jobFit?.salaryAssessment], r).map((t) => reason("note", { text: t }, "salary"));
}

export function salaryWhy(midpoint: number, basis: SalaryBasis, notes: Reason[]): Why {
  const { side, fraction } = salaryDistance(midpoint, basis.min, basis.max);
  const pct = Math.round(fraction * 100);
  const inside = side === "inside";
  const phrase: Phrase = inside
    ? { key: "part.salaryInside", params: { basis: basis.kind } }
    : { key: "part.salaryOutside", params: { pct, direction: side, basis: basis.kind } };
  const an = anatomyOf(SALARY_BASE, [{ phrase, exact: inside ? 0 : -SALARY_SLOPE * fraction, tone: inside ? "pro" : "con" }], salaryRaw(midpoint, basis.min, basis.max));
  return why(
    inside
      ? { key: "sentence.salaryInside", params: { basis: basis.kind } }
      : { key: "sentence.salaryOutside", params: { pct, direction: side, basis: basis.kind } },
    {
      pros: inside ? [reason("pro", phrase, "band", { criterionId: "band" })] : [],
      cons: inside ? [] : [reason("con", phrase, "band", { points: an.parts[0].points, criterionId: "band" })],
      notes,
    },
    { band: { status: inside ? "meets" : fraction <= SALARY_SOFT_WINDOW ? "partial" : "misses" } },
    an
  );
}

// ---- public work -------------------------------------------------------------------------------

export function publicWorkWhy(gh: GithubAnalysis): Why {
  const f = publicWorkFactors(gh);
  const noJd = f.compared === 0;
  const w = noJd ? PUBLIC_WORK_WEIGHTS.noJd : PUBLIC_WORK_WEIGHTS.compared;
  const { matchingSkills: matched, potentialGaps: gaps } = gh.jobFitSignals;
  const { activeRepos: active, totalStars: stars } = gh.metrics;
  const skillPhrase = (skill: string): Phrase => ({ key: "gh.skill", params: { skill } });
  const gapPhrase = (skill: string): Phrase => ({ key: "gh.gap", params: { skill } });
  const activePhrase: Phrase = { key: "part.ghActive", params: { active } };
  const starsPhrase: Phrase = { key: "part.ghStars", params: { stars } };
  const an = anatomyOf(0, [
    ...matched.map((s) => ({ phrase: skillPhrase(s), exact: w.skills / f.compared, tone: "pro" as const })),
    ...gaps.map((s) => ({ phrase: gapPhrase(s), exact: 0, tone: "con" as const })),
    { phrase: activePhrase, exact: w.active * f.active, tone: f.active > 0 ? "pro" : "con" },
    { phrase: starsPhrase, exact: w.stars * f.stars, tone: f.stars > 0 ? "pro" : "con" },
  ], publicWorkRaw(gh));
  const pts = an.parts.map((p) => p.points);
  const [activePts, starsPts] = pts.slice(-2);
  const pros = matched.map((s, i) => reason("pro", skillPhrase(s), "github", { points: pts[i], criterionId: githubCriterionId(s) }));
  const cons = gaps.map((s) => reason("con", gapPhrase(s), "github", { points: -Math.round(w.skills / f.compared), criterionId: githubCriterionId(s) }));
  if (f.active > 0) pros.push(reason("pro", activePhrase, "github", { points: activePts }));
  else cons.push(reason("con", { key: "gh.noActive" }, "github", { points: -w.active }));
  if (f.stars > 0) pros.push(reason("pro", starsPhrase, "github", { points: starsPts }));
  else cons.push(reason("con", { key: "gh.noStars" }, "github", { points: -w.stars }));
  const criteria: Why["criteria"] = {};
  for (const s of matched) criteria[githubCriterionId(s)] = { status: "meets" };
  for (const s of gaps) criteria[githubCriterionId(s)] ??= { status: "misses" };
  return why(
    noJd
      ? { key: "sentence.publicWorkNoJd", params: { active, stars } }
      : { key: "sentence.publicWork", params: { matched: matched.length, compared: f.compared, active, stars } },
    { pros, cons },
    criteria,
    an
  );
}

// ---- the member ----------------------------------------------------------------------------------

/**
 * Every dimension's why for one landed analysis; null wherever the cell is absent. A salary
 * cell still waiting on the cohort (no usable role band) carries its notes only, and
 * resolveCohortSalary replaces it once the cohort's window is known.
 */
export function memberWhy(
  a: Analysis,
  r: Redact,
  role: RoleContext | null,
  cells: Record<CohortDimension, CohortCell>,
  gh: GithubAnalysis | null,
  band: (RoleBand & { currency: string; period: string }) | null
): WhyMap {
  const rated = (d: CohortDimension) => cells[d].tier !== "absent";
  const notes = salaryNotes(a, r);
  let salary: Why | null = null;
  if (rated("salary") && band) salary = salaryWhy(a.salary.midpoint, { kind: "band", min: band.min, max: band.max }, notes);
  else if (cells.salary.absentReason === "pending") salary = pendingSalaryWhy(notes);
  return {
    fit: rated("fit") ? fitWhy(a, r, role) : null,
    skills: rated("skills") ? skillsWhy(a, r) : null,
    experience: rated("experience") ? experienceWhy(a, r, role) : null,
    signals: rated("signals") ? signalsWhy(a, r) : null,
    trust: rated("trust") ? trustWhy(a, r) : null,
    salary,
    publicWork: rated("publicWork") && gh ? publicWorkWhy(gh) : null,
  };
}

/** The interim salary why of a member the cohort has yet to rate: notes only, never on the wire. */
function pendingSalaryWhy(notes: Reason[]): Why {
  return { why: { key: "sentence.salaryInside", params: { basis: "cohort" } }, pros: [], cons: [], notes, criteria: {} };
}

/** No why yet: every dimension null. */
export function emptyWhy(): WhyMap {
  return Object.fromEntries(COHORT_DIMENSIONS.map((d) => [d, null])) as WhyMap;
}

// ---- the cohort's criteria ---------------------------------------------------------------------

type MemberLike = Pick<CohortMember, "cells" | "detail" | "why">;

const humanize = (code: string): string => code.trim().replace(/[_-]+/g, " ").toLowerCase();

function salaryCriterion(band: RoleBand | null, cohortKey: string | null): DimensionCriterion {
  const target = (phrase: Phrase): DimensionCriterion => ({ id: "band", phrase, kind: "target" });
  if (band?.currency && band.period && (band.min != null || band.max != null)) {
    const unit = { currency: band.currency, period: band.period };
    if (band.min != null && band.max != null) return target({ key: "criteria.salaryBand", params: { min: band.min, max: band.max, ...unit } });
    if (band.min != null) return target({ key: "criteria.salaryBandFrom", params: { min: band.min, ...unit } });
    return target({ key: "criteria.salaryBandUpTo", params: { max: band.max!, ...unit } });
  }
  if (cohortKey) {
    const [currency, period] = cohortKey.split("/");
    return target({ key: "criteria.salaryCohort", params: { currency, period, tolerance: 15 } });
  }
  return target({ key: "criteria.salaryNone" });
}

/** First-seen union: one criterion per id, in member order. */
function union(rows: Array<[id: string, phrase: Phrase]>, kind: DimensionCriterion["kind"]): DimensionCriterion[] {
  const out = new Map<string, DimensionCriterion>();
  for (const [id, phrase] of rows) if (!out.has(id)) out.set(id, { id, phrase, kind });
  return [...out.values()];
}

/**
 * The role's rows per dimension: fixed targets from the role (seniority, family, risk,
 * minimum years, the band) and the cohort-wide unions (required skills, soft-signal keys,
 * trust-finding codes, JD skills seen on GitHub).
 */
export function cohortCriteria(
  members: MemberLike[],
  role: RoleContext | null,
  salaryCohortKey: string | null
): Record<CohortDimension, DimensionCriterion[]> {
  const level = role?.seniority ?? null;
  const family = role?.roleFamily ?? null;
  const seniority: DimensionCriterion = {
    id: "seniority",
    phrase: level ? { key: "criteria.seniority", params: { level } } : { key: "criteria.seniorityNone" },
    kind: "target",
  };
  const pick = <T>(f: (m: MemberLike) => T[]) => members.flatMap(f);
  return {
    fit: [
      seniority,
      { id: "family", phrase: family ? { key: "criteria.family", params: { family: humanize(family) } } : { key: "criteria.familyNone" }, kind: "target" },
      { id: "risk", phrase: { key: "criteria.risk" }, kind: "target" },
    ],
    skills: union(
      pick((m) => {
        const d = m.detail.skills;
        return d ? [...d.matched, ...d.unproven, ...d.missing].map((s): [string, Phrase] => [skillCriterionId(s), { text: s }]) : [];
      }),
      "must"
    ),
    experience: [
      {
        id: "minYears",
        phrase: role?.minYears != null ? { key: "criteria.minYears", params: { years: role.minYears } } : { key: "criteria.minYearsNone" },
        kind: "target",
      },
      seniority,
    ],
    signals: union(
      pick((m) =>
        Object.entries(m.why.signals?.criteria ?? {}).map(([id, c]): [string, Phrase] => [id, c.note ?? { text: id.slice("signal:".length) }])
      ),
      "signal"
    ),
    trust: union(
      pick((m) =>
        (m.detail.trust?.findings ?? [])
          .filter((f) => f.severity !== "ok")
          .map((f): [string, Phrase] => [trustCriterionId(f.code), { key: "criteria.trust", params: { code: humanize(f.code) } }])
      ),
      "signal"
    ),
    salary: [salaryCriterion(role?.band ?? null, salaryCohortKey)],
    publicWork: union(
      pick((m) => {
        const d = m.detail.publicWork;
        return d ? [...d.matchedSkills, ...d.potentialGaps].map((s): [string, Phrase] => [githubCriterionId(s), { text: s }]) : [];
      }),
      "must"
    ),
  };
}

/**
 * The last word on every member's why: null wherever the cell is absent, and a status for
 * EVERY criterion of the dimension, in the criteria's order. A criterion the member's record
 * does not speak to is unknown, except trust, where a read record that does not carry a
 * finding meets the check.
 */
export function settleWhy<M extends MemberLike>(members: M[], criteria: Record<CohortDimension, DimensionCriterion[]>): M[] {
  return members.map((m) => {
    const next = { ...m.why };
    for (const d of COHORT_DIMENSIONS) {
      const w = next[d];
      if (!w || m.cells[d].tier === "absent") {
        next[d] = null;
        continue;
      }
      const fallback: CriterionStatus = d === "trust" ? "meets" : "unknown";
      const settled: Why["criteria"] = {};
      for (const c of criteria[d]) settled[c.id] = w.criteria[c.id] ?? { status: fallback };
      next[d] = { ...w, criteria: settled };
    }
    return { ...m, why: next };
  });
}
