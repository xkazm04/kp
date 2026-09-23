// Live readiness for the profile editor: where this candidate will route, and what is
// still missing, computed from the form in memory while the recruiter types.
//
// Before this, the routing line, the completeness meter and the clickable "Add next"
// gaps appeared only after a POST to /api/profile - a Python spawn (profile_cli)
// charged to the save rate limit even for a dry-run preview. Both halves are DATA
// rather than code: detection is a small condition evaluator over
// archetypes.json `detection`, completeness a weighted checklist over ten one-line
// predicates. So this module is a line-for-line port of
//   pipeline/jobfit/registry.py   detect_detailed / _eval / _params / checklist_specs
//   pipeline/jobfit/profile.py    CHECKS / completeness / completeness_gaps
//   pipeline/jobfit/profile_cli.py how the request body feeds the two
// and it is held to them by ONE shared case file
// (pipeline/jobfit/tests/profile_readiness_cases.json) that both test suites assert.
//
// THE SERVER STAYS THE AUTHORITY. This is a preview of what a save will say; the save
// still routes and scores in profile_cli, and the panel shows that result once saved.
//
// Where the rules come from (the critic's revision, and why it matters): a custom
// archetype is created at RUNTIME (createArchetype rewrites archetypes.json, and the
// Python spawn re-reads the file per request), but a client `import` of that file is
// frozen at build. So the archetype ids and each archetype's checklist are read from
// the LIVE `archetypes` prop (ProfileTab's /api/archetypes fetch); only `detection`
// and `commonChecklist` - neither of which is UI-editable - come from the static
// import. Before that fetch lands (an empty prop) the built-in list stands in.
import registry from "@/pipeline/jobfit/archetypes.json";
import type { ArchetypeDef } from "@/app/features/shared/profileTypes";
import { buildProfilePayload } from "./profileEditorPayload";
import { fieldTargetForCheck, type ProfileFieldKey } from "./profileCompletenessFields";
import type { RoutingReasonCode } from "./profileRoutingReasons";

/** The editor form as the save reads it: buildProfilePayload's input plus the four
 *  routing signals the submit hook sends beside the profile. */
export type ReadinessForm = Parameters<typeof buildProfilePayload>[0] & {
  isEnrolled: boolean;
  expectedGraduation: string;
  wantsDomainChange: boolean;
  hasSubstantialExperience: boolean;
};

export type ReadinessGap = { check: string; label: string; target: ProfileFieldKey | null };

export type Readiness = {
  archetype: string;
  confidence: number;
  reasonCodes: RoutingReasonCode[];
  completeness: number;
  /** Unmet checklist items, biggest weight first (profile.completeness_gaps). */
  missingGaps: ReadinessGap[];
};

type Cond =
  | { all: Cond[] }
  | { any: Cond[] }
  | { signal: string; truthy?: boolean; not?: boolean; lt?: number; gte?: number };
type SignalRule = { id: string; when: Cond; scores: Record<string, number>; reasonKind?: string; reason?: string };
type Contradiction = { when: Cond; confidence: number; reasonKind: string; reason: string };
type Detection = {
  selfDeclaredConfidence: number;
  defaultArchetype: string;
  defaultConfidence: number;
  defaultReasonKind: string;
  selfDeclaredReasonKind: string;
  signals: SignalRule[];
  contradictions: Record<string, Contradiction[]>;
};
type ChecklistSpec = { check: string; weight: number; label: string };

const STATIC = registry as unknown as {
  archetypes: ArchetypeDef[];
  commonChecklist: ChecklistSpec[];
  detection: Detection;
};
const DETECTION = STATIC.detection;
const COMMON_CHECKLIST = STATIC.commonChecklist;

type Ctx = Record<string, unknown>;

/** Python's bool(): the truthiness the router's `truthy`/`not` conditions test. */
function pyTruthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}

function evalCond(cond: Cond, ctx: Ctx): boolean {
  if ("all" in cond) return cond.all.every((c) => evalCond(c, ctx));
  if ("any" in cond) return cond.any.some((c) => evalCond(c, ctx));
  const val = ctx[cond.signal];
  if ("truthy" in cond) return pyTruthy(val) === cond.truthy;
  if ("not" in cond) return !pyTruthy(val) === cond.not;
  const has = val !== null && val !== undefined;
  if ("lt" in cond) return has && (val as number) < (cond.lt as number);
  if ("gte" in cond) return has && (val as number) >= (cond.gte as number);
  return false;
}

/** registry._params: the ctx values a reason template interpolates, keyed by
 *  placeholder name, sorted (string.Formatter field names; `{x:g}` -> `x`). */
function templateParams(reason: string, ctx: Ctx): Record<string, string | number | null> {
  const names = new Set<string>();
  for (const m of reason.replace(/\{\{|\}\}/g, "").matchAll(/\{([^{}:!]+)(?:[:!][^{}]*)?\}/g)) names.add(m[1]);
  const out: Record<string, string | number | null> = {};
  for (const name of [...names].sort()) {
    const v = ctx[name];
    out[name] = v === undefined ? null : (v as string | number | null);
  }
  return out;
}

/** Python's round(x, 2) - correctly rounded on the exact binary value, ties to even.
 *  toFixed already rounds the exact value; only an EXACT tie differs (half-up vs
 *  half-even), and a tie is exact only when x*100 is a representable half. */
export function pyRound2(x: number): number {
  const scaled = x * 100;
  if (Number.isInteger(scaled * 2) && !Number.isInteger(scaled)) {
    const floor = Math.floor(scaled);
    return (floor % 2 === 0 ? floor : floor + 1) / 100;
  }
  return Number(x.toFixed(2));
}

function detectRouting(declared: string | null, ctx: Ctx, ids: readonly string[]) {
  const codes: RoutingReasonCode[] = [];
  if (declared !== null && ids.includes(declared)) {
    codes.push({ kind: DETECTION.selfDeclaredReasonKind, params: { archetype: declared } });
    let confidence = DETECTION.selfDeclaredConfidence;
    for (const c of DETECTION.contradictions[declared] ?? []) {
      if (evalCond(c.when, ctx)) {
        codes.push({ kind: c.reasonKind, params: templateParams(c.reason, ctx) });
        confidence = c.confidence;
      }
    }
    return { archetype: declared, confidence, reasonCodes: codes };
  }
  const scores: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const rule of DETECTION.signals) {
    if (!evalCond(rule.when, ctx)) continue;
    for (const [id, delta] of Object.entries(rule.scores)) scores[id] = (scores[id] ?? 0) + delta;
    if (rule.reason) codes.push({ kind: rule.reasonKind as string, params: templateParams(rule.reason, ctx) });
  }
  // Python sums every key it holds, including one a rule names that `ids` lacks.
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  if (total <= 0) {
    codes.push({ kind: DETECTION.defaultReasonKind, params: {} });
    return { archetype: DETECTION.defaultArchetype, confidence: DETECTION.defaultConfidence, reasonCodes: codes };
  }
  // max(ids, key=...) keeps the FIRST maximum: declaration order breaks ties.
  let best = ids[0];
  for (const id of ids) if (scores[id] > scores[best]) best = id;
  return { archetype: best, confidence: pyRound2(scores[best] / total), reasonCodes: codes };
}

/** The wire profile profile_cli validates, reduced to what the checks read (with
 *  CandidateProfileV2's defaults for an absent field). */
type CheckProfile = {
  educationLevel: string;
  educationDetail: string;
  languages: unknown[];
  aspirations: unknown[];
  skillClaims: unknown[];
  evidenceKinds: Set<string>;
  seniority: unknown;
  yearsExperience: unknown;
};

function toCheckProfile(p: Record<string, unknown>): CheckProfile {
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const opt = (v: unknown) => (v === undefined ? null : v);
  return {
    educationLevel: typeof p.educationLevel === "string" ? p.educationLevel : "unknown",
    educationDetail: typeof p.educationDetail === "string" ? p.educationDetail : "",
    languages: list(p.languages),
    aspirations: list(p.aspirations),
    skillClaims: list(p.skillClaims),
    evidenceKinds: new Set(
      list(p.evidence).map((e) => {
        const kind = (e as { kind?: unknown } | null)?.kind;
        return typeof kind === "string" ? kind : "other";
      })
    ),
    seniority: opt(p.seniority),
    yearsExperience: opt(p.yearsExperience),
  };
}

const hasAny = (kinds: Set<string>, wanted: string[]) => wanted.some((k) => kinds.has(k));

/** profile.py CHECKS, one predicate per check id. A lockstep test reads the Python
 *  table's keys, so a check added on one side only is a red gate. */
export const CHECK_PREDICATES: Record<string, (p: CheckProfile) => boolean> = {
  education_known: (p) => p.educationLevel !== "unknown",
  has_languages: (p) => p.languages.length > 0,
  min_3_skills: (p) => p.skillClaims.length >= 3,
  has_aspirations: (p) => p.aspirations.length > 0,
  has_education_detail: (p) => p.educationDetail.trim() !== "",
  has_project_or_thesis: (p) => hasAny(p.evidenceKinds, ["project", "thesis"]),
  has_activity: (p) => hasAny(p.evidenceKinds, ["internship", "extracurricular", "certification", "job"]),
  has_seniority: (p) => p.seniority !== null,
  has_years: (p) => p.yearsExperience !== null,
  has_job: (p) => hasAny(p.evidenceKinds, ["job"]),
};

/** registry.checklist_specs over the LIVE archetypes: common items first, then the
 *  archetype's own; an unknown archetype falls back to the default one's list. */
function checklistSpecs(archetype: string, archetypes: readonly ArchetypeDef[]): ChecklistSpec[] {
  const entry =
    archetypes.find((a) => a.id === archetype) ?? archetypes.find((a) => a.id === DETECTION.defaultArchetype);
  return [...COMMON_CHECKLIST, ...((entry?.checklist ?? []) as ChecklistSpec[])];
}

/**
 * Readiness for a request body exactly as the editor sends it to /api/profile:
 * `{profile, signals}` in, profile_cli's archetype / confidence / reasonCodes /
 * completeness / missingGaps out. The shared case file is asserted at this seam.
 */
export function readinessFromRequest(
  profile: Record<string, unknown>,
  signals: Record<string, unknown>,
  archetypes: readonly ArchetypeDef[]
): Readiness {
  const live = archetypes.length ? archetypes : STATIC.archetypes;
  const ids = live.map((a) => a.id);
  const p = toCheckProfile(profile);
  const declaredRaw = signals.selfDeclared;
  const declared = typeof declaredRaw === "string" && ids.includes(declaredRaw) ? declaredRaw : null;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(signals, k) && signals[k] !== undefined;
  const ctx: Ctx = {
    // signals.get("yearsRelevantExperience", profile.years_experience)
    years_relevant_experience: has("yearsRelevantExperience") ? signals.yearsRelevantExperience : p.yearsExperience,
    is_enrolled: signals.isEnrolled ?? null,
    expected_graduation: signals.expectedGraduation ?? null,
    education_is_dominant: signals.educationIsDominant ?? null,
    wants_domain_change: signals.wantsDomainChange ?? null,
    has_substantial_experience: signals.hasSubstantialExperience ?? null,
  };
  const routing = detectRouting(declared, ctx, ids);

  const specs = checklistSpecs(routing.archetype, live);
  const met = (check: string) => (CHECK_PREDICATES[check] ?? (() => false))(p); // fail closed
  const total = specs.reduce((a, s) => a + Number(s.weight), 0);
  const got = specs.reduce((a, s) => a + (met(s.check) ? Number(s.weight) : 0), 0);
  const missingGaps = specs
    .filter((s) => !met(s.check))
    .map((s) => ({ spec: s }))
    // Array.prototype.sort is stable, as Python's list.sort is: equal weights keep spec order.
    .sort((a, b) => Number(b.spec.weight) - Number(a.spec.weight))
    .map(({ spec }) => ({ check: spec.check, label: spec.label, target: fieldTargetForCheck(spec.check) }));

  return {
    ...routing,
    completeness: total ? pyRound2(got / total) : 0,
    missingGaps,
  };
}

/** The routing signals the save sends beside the profile - the same object
 *  useProfileEditorSubmit builds (a test pins the two against each other). */
export function readinessSignals(form: ReadinessForm): Record<string, unknown> {
  return {
    selfDeclared: form.choice,
    isEnrolled: form.isEnrolled,
    expectedGraduation: form.expectedGraduation || undefined,
    wantsDomainChange: form.wantsDomainChange,
    hasSubstantialExperience: form.hasSubstantialExperience,
  };
}

/** The editor's live readiness. The form is read through buildProfilePayload - the
 *  save's own visibility rule - so a value the form hides (years under student) is
 *  invisible here exactly as it is to the save. The payload is serialized the way
 *  fetch serializes it, so `undefined` fields are absent as they are on the wire. */
export function readiness(form: ReadinessForm, archetypes: readonly ArchetypeDef[]): Readiness {
  const profile = JSON.parse(JSON.stringify(buildProfilePayload(form))) as Record<string, unknown>;
  const signals = JSON.parse(JSON.stringify(readinessSignals(form))) as Record<string, unknown>;
  return readinessFromRequest(profile, signals, archetypes);
}
