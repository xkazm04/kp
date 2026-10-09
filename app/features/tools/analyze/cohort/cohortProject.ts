// Cohort engine, half one: one saved Analysis -> one member as the comparison sees it,
// and the projected members -> the whole CohortView (spark analyze-v2-cohort, WP1).
//
// CLIENT-SAFE and pure: it reads the wire contract, the Analysis TYPE and the
// dependency-free GitHub handle parser, nothing else — so the server route, the
// fixture script and any client surface compute the SAME cells.
//
// Every rule below is a recorded decision, and the registry's absent-score rule
// governs all of them: a dimension with no evidence is an `absent` cell with its
// REASON, never a 0 and never a neutral midpoint.
//
// Rating rules (0-100, integers; tiers >=75 strong, >=55 solid, >=35 thin, else weak):
//   fit         jobFit.score. Band = +/-5 widened by named drivers (bandDrivers).
//   skills      (proven matched + half of unproven) / (matched + unproven + missing).
//   experience  (score.experience + score.roleSeniority) / 48 * 100 (their maxima 25 + 23).
//   signals     50 + 12 * (sum strength confidence - sum antipattern confidence).
//   trust       100 - 15 per warn - 40 per blocker.
//   salary      against the role band when it states a currency + period; else against
//               the cohort's majority-currency median (resolved in assembleCohortView).
//   publicWork  40% matched-skill ratio + 30% active repos (/10) + 30% log-scaled stars.
// The formulas themselves live ONCE in cohortFormula.ts; the why of every rated cell (pros,
// cons, the exact score anatomy, the role's criteria) is cohortWhy.ts's.
import type { Analysis } from "../../../../_lib/schemas.ts";
import { parseGithubUsername } from "../../../../_lib/github-handle.ts";
import { COHORT_DIMENSIONS, COHORT_MIN, isTechnicalFamily } from "./cohortTypes.ts";
import type {
  AbsentReason,
  CellTier,
  CohortCell,
  CohortComments,
  CohortDimension,
  CohortMember,
  CohortView,
  Membership,
  MemberRunState,
  RoleBand,
  RoleContext,
  PublicWorkDetail,
  ShortLabel,
} from "./cohortTypes.ts";
import { computeCohortClaims, neutralOrder } from "./cohortClaims.ts";
import {
  clampRating,
  experienceRaw,
  norm,
  publicWorkRating,
  rateAgainstRange,
  signalsRaw,
  skillSets,
  skillsRaw,
  trustRaw,
} from "./cohortFormula.ts";
import { cohortCriteria, emptyWhy, memberWhy, salaryWhy, settleWhy } from "./cohortWhy.ts";

export {
  clampRating,
  EXPERIENCE_SCALE,
  publicWorkRating,
  rateAgainstRange,
  skillSets,
  STAR_SATURATION,
} from "./cohortFormula.ts";
export { emptyWhy } from "./cohortWhy.ts";

export interface ProjectInput {
  memberId: string;
  label: string;
  membership: Membership;
  runState: MemberRunState;
  analysisSlug: string | null;
  analysis: Analysis | null;
  blind: boolean;
  /** What the role asks for (its band rates salary; the rest feeds the criteria); null when the job is gone. */
  role: RoleContext | null;
}
export type ProjectedMember = Omit<CohortMember, "neutralIndex" | "fitRank" | "decoyOf">;

// ---- small pure helpers ------------------------------------------------------------

export function tierOf(rating: number): Exclude<CellTier, "absent"> {
  if (rating >= 75) return "strong";
  if (rating >= 55) return "solid";
  if (rating >= 35) return "thin";
  return "weak";
}

/**
 * The label every absent cell carries unless the dimension has its own fact to show
 * ("No rating"). The "—" glyph is the UI's, in code: the catalogs ban the em dash
 * (docs/i18n/contract.md §5), and the WHY is `absentReason` -> analyzeCohort.absent.
 */
export const NONE_LABEL: ShortLabel = { key: "none" };

export function absentCell(dimension: CohortDimension, reason: AbsentReason, label: ShortLabel = NONE_LABEL): CohortCell {
  return { dimension, rating: null, tier: "absent", absentReason: reason, label };
}

function ratedCell(dimension: CohortDimension, raw: number, label: ShortLabel, band?: CohortCell["band"]): CohortCell {
  const rating = clampRating(raw);
  const cell: CohortCell = { dimension, rating, tier: tierOf(rating), label };
  if (band) cell.band = band;
  return cell;
}

/** One decimal, so 9 stays 9 and 2.46 reads 2.5. */
const oneDecimal = (n: number): number => Math.round(n * 10) / 10;

function emptyDetail(): ProjectedMember["detail"] {
  return { fit: null, skills: null, experience: null, signals: null, trust: null, salary: null, publicWork: null };
}

function allAbsent(reason: AbsentReason): Record<CohortDimension, CohortCell> {
  const cells = {} as Record<CohortDimension, CohortCell>;
  for (const d of COHORT_DIMENSIONS) cells[d] = absentCell(d, reason);
  return cells;
}

// ---- blind redaction ---------------------------------------------------------------

/** What a candidate's name becomes inside a detail string of a blind cohort. */
export const REDACTED = "[…]";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace the candidate's full name, then each of its parts, wherever it appears as a
 * whole word (letter-bounded, Unicode-aware so "Blažková" is one word). Model prose
 * names the candidate ("Klára Blažková is a strong fit…"), and a blind cohort must not
 * carry that name into any detail string this module emits.
 */
export function makeRedactor(name: string | null | undefined): (text: string) => string {
  const full = (name ?? "").trim();
  if (!full) return (t) => t;
  const parts = [full, ...full.split(/\s+/).filter((p) => p.length >= 2)];
  const patterns = parts.map((p) => new RegExp(`(?<!\\p{L})${escapeRegExp(p)}(?!\\p{L})`, "giu"));
  return (text) => patterns.reduce((acc, re) => acc.replace(re, REDACTED), text);
}

// ---- fit ---------------------------------------------------------------------------

export const FIT_BAND_BASE = 5;

/** Is this analysis a deterministic (keyless) engine's output? Its fit is a heuristic. */
export function isDeterministicEngine(analysis: Analysis): boolean {
  const meta = analysis.metadata;
  if (!meta) return false;
  if (norm(meta.engineKind ?? "") === "deterministic") return true;
  return norm(meta.analysisEngine ?? "").includes("deterministic");
}

const isEducationUnknown = (level: string | null | undefined): boolean => {
  const v = norm(level ?? "");
  return v === "" || v === "unknown" || v === "none" || v === "n/a";
};

/**
 * The named widenings of the fit band. Monotone (each source only adds) and every
 * increment carries its driver, so a wide band reads as a property of the RECORD.
 */
export function bandDrivers(analysis: Analysis): { width: number; drivers: ShortLabel[] } {
  const drivers: ShortLabel[] = [];
  let width = FIT_BAND_BASE;
  const skills = analysis.candidate.skills ?? [];
  if (skills.length < 3) {
    width += 4;
    drivers.push({ key: "drivers.fewSkills", params: { n: skills.length } });
  }
  if (isEducationUnknown(analysis.candidate.educationLevel)) {
    width += 3;
    drivers.push({ key: "drivers.educationUnknown" });
  }
  const missing = analysis.jobFit?.missingSkills ?? [];
  if (missing.length >= 3) {
    width += 4;
    drivers.push({ key: "drivers.manyMissing", params: { n: missing.length } });
  }
  const findings = analysis.trustFindings ?? [];
  const warns = findings.filter((f) => f.severity === "warn").length;
  if (warns > 0) {
    width += Math.min(9, 3 * warns);
    drivers.push({ key: "drivers.trustWarn", params: { n: warns } });
  }
  if (findings.some((f) => f.severity === "blocker")) {
    width += 8;
    drivers.push({ key: "drivers.trustBlocker" });
  }
  if (isDeterministicEngine(analysis)) {
    width += 5;
    drivers.push({ key: "drivers.keylessEngine" });
  }
  return { width, drivers };
}

function fitCell(analysis: Analysis): CohortCell {
  const jf = analysis.jobFit;
  if (!jf) return absentCell("fit", "noJdFit");
  const rating = clampRating(jf.score);
  const { width, drivers } = bandDrivers(analysis);
  return ratedCell("fit", rating, { key: "cells.fit", params: { score: rating } }, {
    lo: clampRating(rating - width),
    hi: clampRating(rating + width),
    drivers,
  });
}

// ---- skills ------------------------------------------------------------------------

function skillsCell(analysis: Analysis): CohortCell {
  const sets = skillSets(analysis);
  const score = sets ? skillsRaw(sets) : null;
  // No JD skill list to measure against is the same absence as no job fit at all.
  if (!sets || score === null) return absentCell("skills", "noJdFit");
  const total = sets.matched.length + sets.unproven.length + sets.missing.length;
  const label: ShortLabel = sets.unproven.length
    ? { key: "cells.skillsUnproven", params: { matched: sets.matched.length, total, unproven: sets.unproven.length } }
    : { key: "cells.skills", params: { matched: sets.matched.length, total } };
  return ratedCell("skills", score, label);
}

// ---- experience --------------------------------------------------------------------

function experienceCell(analysis: Analysis): CohortCell {
  const seniority = analysis.candidate.currentSeniority?.trim() || "unknown";
  return ratedCell("experience", experienceRaw(analysis.score), {
    key: "cells.experience",
    params: { years: oneDecimal(analysis.candidate.yearsExperience), seniority },
  });
}

// ---- signals -----------------------------------------------------------------------

function signalsCell(analysis: Analysis): CohortCell {
  const ss = analysis.softSignals;
  if (!ss) return absentCell("signals", "notRead");
  return ratedCell("signals", signalsRaw(ss), {
    key: "cells.signals",
    params: { strengths: ss.strengths.length, flags: ss.antipatterns.length },
  });
}

// ---- trust -------------------------------------------------------------------------

function trustCell(analysis: Analysis): CohortCell {
  const findings = analysis.trustFindings;
  if (!findings) return absentCell("trust", "notRead");
  const warns = findings.filter((f) => f.severity === "warn").length;
  const blockers = findings.filter((f) => f.severity === "blocker").length;
  const flags = warns + blockers;
  return ratedCell(
    "trust",
    trustRaw(findings),
    flags ? { key: "cells.trustFlags", params: { n: flags } } : { key: "cells.trustClean" }
  );
}

// ---- salary ------------------------------------------------------------------------

/** The key a salary partition is filed under: "CZK/month". */
export const salaryKey = (currency: string, period: string): string => `${currency.trim().toUpperCase()}/${period.trim().toLowerCase()}`;

/** How a cohort-median rating tolerates spread: within +/-15% of the median counts as "at" it. */
export const COHORT_MEDIAN_TOLERANCE = 0.15;

/** A band is usable only when it names a currency AND a period AND at least one edge. */
export function usableBand(band: RoleBand | null): band is RoleBand & { currency: string; period: string } {
  return Boolean(band && band.currency && band.period && (band.min != null || band.max != null));
}

function salaryLabel(key: "cells.salaryBand" | "cells.salaryCohort", s: Analysis["salary"]): ShortLabel {
  return { key, params: { midpoint: s.midpoint, currency: s.currency, period: s.period } };
}

function salaryCell(analysis: Analysis, band: RoleBand | null): CohortCell {
  const s = analysis.salary;
  if (!s || !Number.isFinite(s.midpoint) || !s.currency || !s.period) return absentCell("salary", "notRead");
  if (usableBand(band)) {
    const label = salaryLabel("cells.salaryBand", s);
    // A figure in another currency or pay basis is shown on its own record, never rated.
    if (salaryKey(s.currency, s.period) !== salaryKey(band.currency, band.period)) return absentCell("salary", "currencyMismatch", label);
    return ratedCell("salary", rateAgainstRange(s.midpoint, band.min, band.max), label);
  }
  // No usable band: the cohort decides (assembleCohortView -> resolveCohortSalary).
  return absentCell("salary", "pending", salaryLabel("cells.salaryCohort", s));
}

/**
 * The no-band rule. The cohort's MAJORITY currency+period (most members; a tie goes to
 * the alphabetically first key) is the only partition rated; everyone else is
 * `currencyMismatch`. Each member of it is rated against the partition's median with
 * the +/-COHORT_MEDIAN_TOLERANCE window as the "band" (rateAgainstRange). Mutates nothing.
 */
const waitingOnCohort = (m: ProjectedMember): boolean => m.cells.salary.label.key === "cells.salaryCohort" && m.cells.salary.absentReason === "pending";

/** The no-band window: the majority partition's key and its median +/- tolerance; null when nobody waits on it. */
export function cohortSalaryWindow(members: ProjectedMember[]): { key: string; lo: number; hi: number } | null {
  const waiting = members.filter(waitingOnCohort);
  if (waiting.length === 0) return null;
  const counts = new Map<string, number[]>();
  for (const m of waiting) {
    const d = m.detail.salary!;
    const key = salaryKey(d.currency!, d.period!);
    counts.set(key, [...(counts.get(key) ?? []), d.midpoint!]);
  }
  const [majority, mids] = [...counts.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))[0];
  const sorted = [...mids].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { key: majority, lo: median * (1 - COHORT_MEDIAN_TOLERANCE), hi: median * (1 + COHORT_MEDIAN_TOLERANCE) };
}

export function resolveCohortSalary(members: ProjectedMember[]): ProjectedMember[] {
  const window = cohortSalaryWindow(members);
  if (!window) return members;
  return members.map((m) => {
    if (!waitingOnCohort(m)) return m;
    const d = m.detail.salary!;
    const label = m.cells.salary.label;
    if (salaryKey(d.currency!, d.period!) !== window.key) {
      return { ...m, cells: { ...m.cells, salary: absentCell("salary", "currencyMismatch", label) }, why: { ...m.why, salary: null } };
    }
    const cell = ratedCell("salary", rateAgainstRange(d.midpoint!, window.lo, window.hi), label);
    // The interim why carried the analysis's salary notes; the window now explains the rating.
    const why = salaryWhy(d.midpoint!, { kind: "cohort", min: window.lo, max: window.hi }, m.why.salary?.notes ?? []);
    return { ...m, cells: { ...m.cells, salary: cell }, why: { ...m.why, salary: why } };
  });
}

// ---- public work -------------------------------------------------------------------

/** The first CV link that is a github.com profile (parsed by the shared handle grammar). */
export function githubLinkOf(analysis: Analysis): string | null {
  for (const link of analysis.candidate.links ?? []) {
    if (/github\.com/i.test(link) && parseGithubUsername(link)) return link;
  }
  return null;
}

type GithubRead = NonNullable<NonNullable<Analysis["githubDeepDive"]>["analysis"]>;

function publicWork(analysis: Analysis, blind: boolean): { cell: CohortCell; detail: PublicWorkDetail | null; gh: GithubRead | null } {
  const absent = (r: AbsentReason) => ({ cell: absentCell("publicWork", r), detail: null, gh: null });
  if (blind) return absent("blind");
  if (!isTechnicalFamily(analysis.candidate.roleFamily)) return absent("notTechnical");
  if (!githubLinkOf(analysis)) return absent("noLink");
  const dive = analysis.githubDeepDive;
  if (dive?.status === "error") return absent("failed");
  if (!dive || dive.status !== "done" || !dive.analysis) return absent("notRead");
  const gh = dive.analysis;
  const language = gh.languages[0]?.name ?? null;
  const label: ShortLabel = language
    ? { key: "cells.publicWork", params: { repos: gh.metrics.publicRepos, language } }
    : { key: "cells.publicWorkNoLanguage", params: { repos: gh.metrics.publicRepos } };
  return {
    cell: ratedCell("publicWork", publicWorkRating(gh), label),
    gh,
    detail: {
      dimension: "publicWork",
      username: gh.username,
      profileUrl: gh.profileUrl || null,
      publicRepos: gh.metrics.publicRepos,
      totalStars: gh.metrics.totalStars,
      activeRepos: gh.metrics.activeRepos,
      languages: gh.languages.map((l) => ({ name: l.name, percent: l.percent })),
      topRepos: gh.topRepositories.slice(0, 5).map((r) => ({ name: r.name, url: r.url, language: r.primaryLanguage, stars: r.stars })),
      matchedSkills: gh.jobFitSignals.matchingSkills,
      potentialGaps: gh.jobFitSignals.potentialGaps,
    },
  };
}

// ---- the member --------------------------------------------------------------------

/** One Analysis (or none yet) -> one member. Pure; the cohort-level steps are assembleCohortView's. */
export function projectCohortMember(input: ProjectInput): ProjectedMember {
  const base = { memberId: input.memberId, label: input.label, membership: input.membership, runState: input.runState, analysisSlug: input.analysisSlug };
  const a = input.analysis;
  if (!a) {
    // Not landed: pending while it runs, failed when it failed. A "done" member with no
    // readable analysis is a record we could not read — not a failure we observed.
    const reason: AbsentReason = input.runState === "failed" ? "failed" : input.runState === "done" || input.runState === "reused" ? "notRead" : "pending";
    return { ...base, roleFamily: null, cells: allAbsent(reason), detail: emptyDetail(), why: emptyWhy() };
  }
  const r = input.blind ? makeRedactor(a.candidate.name) : (t: string) => t;
  const jf = a.jobFit ?? null;
  const sets = skillSets(a);
  const known = new Set([...(sets?.matched ?? []), ...(sets?.missing ?? []), ...(sets?.unproven ?? [])].map(norm));
  const pw = publicWork(a, input.blind);
  const ss = a.softSignals;
  const sig = (s: NonNullable<typeof ss>["strengths"][number]) => ({
    label: r(s.label),
    detail: r(s.detail),
    probe: s.suggestedProbe ? r(s.suggestedProbe) : null,
    confidence: typeof s.confidence === "number" ? s.confidence : null,
  });
  const band = usableBand(input.role?.band ?? null) ? (input.role!.band as RoleBand & { currency: string; period: string }) : null;
  const cells: Record<CohortDimension, CohortCell> = {
    fit: fitCell(a),
    skills: skillsCell(a),
    experience: experienceCell(a),
    signals: signalsCell(a),
    trust: trustCell(a),
    salary: salaryCell(a, input.role?.band ?? null),
    publicWork: pw.cell,
  };
  return {
    ...base,
    why: memberWhy(a, r, input.role, cells, pw.gh, band),
    roleFamily: a.candidate.roleFamily || null,
    cells,
    detail: {
      fit: {
        dimension: "fit",
        jobFitScore: jf ? clampRating(jf.score) : null,
        total: Number.isFinite(a.score.total) ? a.score.total : null,
        seniorityAlignment: jf?.seniorityAlignment ? r(jf.seniorityAlignment) : null,
        roleAlignment: jf?.roleAlignment ? r(jf.roleAlignment) : null,
        summary: jf?.summary ? r(jf.summary) : null,
        riskFlags: (jf?.recruiterRiskFlags ?? []).map(r),
      },
      skills: sets
        ? {
            dimension: "skills",
            matched: sets.matched,
            missing: sets.missing,
            unproven: sets.unproven,
            extra: (a.candidate.skills ?? []).filter((s) => !known.has(norm(s))),
          }
        : null,
      experience: {
        dimension: "experience",
        years: Number.isFinite(a.candidate.yearsExperience) ? a.candidate.yearsExperience : null,
        seniority: a.candidate.currentSeniority || null,
        roleFamily: a.candidate.roleFamily || null,
        educationLevel: a.candidate.educationLevel || null,
        evidence: (a.candidate.evidence ?? []).map(r),
      },
      signals: ss ? { dimension: "signals", strengths: ss.strengths.map(sig), antipatterns: ss.antipatterns.map(sig) } : null,
      trust: a.trustFindings
        ? { dimension: "trust", findings: a.trustFindings.map((f) => ({ code: f.code, severity: f.severity, scope: f.scope, text: r(f.text) })) }
        : null,
      salary: a.salary
        ? {
            dimension: "salary",
            currency: a.salary.currency || null,
            period: a.salary.period || null,
            minimum: a.salary.minimum,
            maximum: a.salary.maximum,
            midpoint: a.salary.midpoint,
            confidence: a.salary.confidence || null,
          }
        : null,
      publicWork: pw.detail,
    },
  };
}

// ---- the view ----------------------------------------------------------------------

const BLIND_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** The blind label for a neutral position: "Candidate A".."T" (then "Candidate 27"…). */
export const blindLabel = (neutralIndex: number): string =>
  `Candidate ${neutralIndex < BLIND_LETTERS.length ? BLIND_LETTERS[neutralIndex] : String(neutralIndex + 1)}`;

/** Merge the comparative pass's rare cell comments: rated cells only, non-empty only. */
function withComments(members: ProjectedMember[], comments: CohortComments | null): ProjectedMember[] {
  if (!comments?.cells.length) return members;
  return members.map((m) => {
    const mine = comments.cells.filter((c) => c.memberId === m.memberId && c.comment.trim());
    if (!mine.length) return m;
    const cells = { ...m.cells };
    for (const c of mine) {
      const cell = cells[c.dimension];
      if (cell && cell.tier !== "absent") cells[c.dimension] = { ...cell, comment: c.comment.trim() };
    }
    return { ...m, cells };
  });
}

/**
 * Projected members -> the whole comparison. Resolves the cohort-relative salary cells,
 * relabels a blind cohort by neutral order, merges the model's comments/notes/narrative
 * (it never changes a claim), and lets computeCohortClaims decide every claim. The role's
 * criteria are built from `role` plus the cohort-wide unions, and every member's why is
 * settled against them (cohortWhy.settleWhy).
 * Member order is the input order; neutralIndex is the presentation order.
 */
export function assembleCohortView(
  base: Omit<CohortView, "members" | "claims" | "narrative" | "progress" | "criteria" | "roleBand">,
  members: ProjectedMember[],
  comments: CohortComments | null,
  role: RoleContext | null = null
): CohortView {
  const window = cohortSalaryWindow(members);
  let projected = withComments(resolveCohortSalary(members), comments);
  const criteria = cohortCriteria(projected, role, window?.key ?? null);
  projected = settleWhy(projected, criteria);
  if (base.blind) {
    const order = neutralOrder(base.cohortId, projected.map((m) => m.memberId));
    projected = projected.map((m) => ({ ...m, label: blindLabel(order.indexOf(m.memberId)) }));
  }
  const { claims, fitRank, decoyOf, neutralIndex } = computeCohortClaims(projected, base.cohortId);
  for (const d of COHORT_DIMENSIONS) {
    const note = comments?.notes[d]?.trim();
    if (note) claims.byDimension[d] = { ...claims.byDimension[d], note };
  }
  const ids = new Set(projected.map((m) => m.memberId));
  const raw = comments?.narrative ?? null;
  const narrative =
    raw && claims.byDimension.fit.rated >= COHORT_MIN && raw.text.trim()
      ? { ...raw, covers: raw.covers.filter((id) => ids.has(id)) }
      : null;
  return {
    ...base,
    members: projected.map((m) => ({
      ...m,
      neutralIndex: neutralIndex.get(m.memberId) ?? 0,
      fitRank: fitRank.get(m.memberId) ?? null,
      decoyOf: decoyOf.get(m.memberId) ?? null,
    })),
    claims,
    narrative,
    criteria,
    roleBand: role?.band ?? null,
    progress: {
      total: projected.length,
      // `done` counts every landed member; `reused` is the subset that spent nothing.
      done: projected.filter((m) => m.runState === "done" || m.runState === "reused").length,
      reused: projected.filter((m) => m.runState === "reused").length,
      failed: projected.filter((m) => m.runState === "failed").length,
    },
  };
}
