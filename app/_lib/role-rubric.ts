import type { RubricAxis } from "./schemas.generated";
import type { RoleBrief } from "./rolespec";

// The role-rubric derivation (ADR-0012 §2) for the TS callers — a line-for-line
// mirror of pipeline/jobfit/rolerubric.py::derive_role_rubric, whose module
// docstring states the rules once. Both implementations are pinned to ONE fixture
// (pipeline/jobfit/tests/fixtures/role_rubric_cases.json, read by
// role-rubric.test.ts and test_rolerubric.py) with weights compared exactly, so a
// rule changed in one language and not the other turns a suite red.
//
// Pure, DB-free and keyless: the brief's grading is already structured, so no
// provider is involved. The frozen, versioned store the result is minted into is
// app/_lib/db/role-rubrics.ts.
//
// Known edge the parity fixture does not cover: key normalisation lower-cases with
// String#toLowerCase and orders with code-unit comparison, which match Python's
// str.lower() and code-point ordering for every Latin script (Czech included) but
// not for a handful of special cases (Turkish dotted İ, astral-plane characters).

type EvidenceClass = RubricAxis["evidenceClass"];

const EVIDENCE_SOURCES: Record<EvidenceClass, [RubricAxis["humanEvidence"], RubricAxis["agentEvidence"]]> = {
  requirement_coverage: ["analysis", "agent_fit"],
  demonstrated_work: ["devcase", "trial_run"],
  conversation: ["scorecard", "mandate_exchange"],
  cost: ["salary_band", "budget"],
};

const FACET_EVIDENCE_CLASS: Record<string, EvidenceClass> = {
  budget_band: "cost",
  work_environment: "demonstrated_work",
  codebase_dossier: "demonstrated_work",
};

type Kind = "must_have" | "nice_to_have";
type Hardness = "prerequisite" | "learnable";

const KIND_FACTOR: Record<Kind, number> = { must_have: 1, nice_to_have: 0.5 };
const KIND_RANK: Record<Kind, number> = { must_have: 0, nice_to_have: 1 };
const HARDNESS_RANK: Record<Hardness, number> = { prerequisite: 0, learnable: 1 };
const MIN_REQUIREMENT_WEIGHT = 0.05;
const DEFAULT_REQUIREMENT_WEIGHT = 0.5;
const CORE_FACET_RAW_WEIGHT = 0.5;

// The BriefRequirement / BriefFacet defaults (rolebrief.py), for rows read from a
// stored blob that predates a field.
const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);
const collapse = (text: string): string => text.split(/\s+/).filter(Boolean).join(" ");
const isKind = (value: string): value is Kind => value === "must_have" || value === "nice_to_have";
const isHardness = (value: string): value is Hardness => value === "prerequisite" || value === "learnable";
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function evidence(evidenceClass: EvidenceClass): Pick<RubricAxis, "evidenceClass" | "humanEvidence" | "agentEvidence"> {
  const [humanEvidence, agentEvidence] = EVIDENCE_SOURCES[evidenceClass];
  return { evidenceClass, humanEvidence, agentEvidence };
}

type MergedRequirement = {
  key: string;
  label: string;
  kind: Kind;
  hardness: Hardness;
  weight: number;
  provenance: string;
  rationale: string;
};

type CoreFacet = {
  key: string;
  label: string;
  origin: "facet" | "cost";
  provenance: string;
  rationale: string;
  evidenceClass: EvidenceClass;
};

/** The rubric axes a RoleBrief states. Pure: same brief, same list, every time. An
 *  empty list is a real answer (no graded requirement, no core facet) — refusing to
 *  mint an empty rubric is the store's call. */
export function deriveRoleRubric(brief: RoleBrief): RubricAxis[] {
  const merged = new Map<string, MergedRequirement>();
  for (const req of brief.requirements ?? []) {
    const label = collapse(str(req?.skill));
    if (!label) continue;
    const rawKind = str(req.kind, "must_have");
    const rawHardness = str(req.hardness, "prerequisite");
    const kind: Kind = isKind(rawKind) ? rawKind : "must_have";
    const hardness: Hardness = isHardness(rawHardness) ? rawHardness : "prerequisite";
    const stated = typeof req.weight === "number" && Number.isFinite(req.weight) ? req.weight : DEFAULT_REQUIREMENT_WEIGHT;
    const weight = Math.max(MIN_REQUIREMENT_WEIGHT, Math.min(1, stated));
    const key = `req:${label.toLowerCase()}`;
    const rationale = str(req.rationale).trim();
    const seen = merged.get(key);
    if (!seen) {
      merged.set(key, { key, label, kind, hardness, weight, provenance: str(req.provenance, "inferred"), rationale });
      continue;
    }
    if (KIND_RANK[kind] < KIND_RANK[seen.kind]) seen.kind = kind;
    if (HARDNESS_RANK[hardness] < HARDNESS_RANK[seen.hardness]) seen.hardness = hardness;
    seen.weight = Math.max(seen.weight, weight);
    if (!seen.rationale) seen.rationale = rationale;
  }

  const facets = new Map<string, CoreFacet>();
  for (const facet of brief.facets ?? []) {
    if (str(facet?.importance, "valuable") !== "core") continue;
    const name = collapse(str(facet.key)).toLowerCase() || collapse(str(facet.label)).toLowerCase();
    const value = str(facet.value).trim();
    if (!name || !value) continue;
    const evidenceClass = FACET_EVIDENCE_CLASS[name] ?? "conversation";
    const origin = evidenceClass === "cost" ? "cost" : "facet";
    const key = `${origin}:${name}`;
    if (facets.has(key)) continue; // first statement of a facet wins
    facets.set(key, {
      key,
      label: str(facet.label).trim() || str(facet.key).trim(),
      origin,
      provenance: str(facet.provenance, "inferred"),
      rationale: value,
      evidenceClass,
    });
  }

  const blockingRank = (r: MergedRequirement) => (r.kind === "must_have" && r.hardness === "prerequisite" ? 0 : 1);
  const rawOf = (r: MergedRequirement) => r.weight * KIND_FACTOR[r.kind];
  const requirements = [...merged.values()].sort(
    (a, b) =>
      blockingRank(a) - blockingRank(b) ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      rawOf(b) - rawOf(a) ||
      cmp(a.key, b.key)
  );
  const facetRows = [...facets.values()].sort((a, b) => cmp(a.key, b.key));

  const raws = [...requirements.map(rawOf), ...facetRows.map(() => CORE_FACET_RAW_WEIGHT)];
  // Summed left to right, as the Python side does, so the shares are bit-identical.
  let total = 0;
  for (const raw of raws) total += raw;

  const axes: RubricAxis[] = requirements.map((r, index) => ({
    key: r.key,
    label: r.label,
    origin: "requirement",
    kind: r.kind,
    hardness: r.hardness,
    weight: raws[index] / total,
    blocking: r.kind === "must_have" && r.hardness === "prerequisite",
    provenance: r.provenance,
    ...evidence("requirement_coverage"),
    rationale: r.rationale,
  }));
  const offset = requirements.length;
  facetRows.forEach((f, index) => {
    axes.push({
      key: f.key,
      label: f.label,
      origin: f.origin,
      kind: "core",
      hardness: "",
      weight: raws[offset + index] / total,
      blocking: false,
      provenance: f.provenance,
      ...evidence(f.evidenceClass),
      rationale: f.rationale,
    });
  });
  return axes;
}

// ---------------------------------------------------------------------------
// Evaluation — ONE function, both populations (ADR-0012 §3)
// ---------------------------------------------------------------------------
//
// A person and an AI agent on one role's slate are judged against the SAME frozen
// axes by the SAME function. What differs per population is only the EVIDENCE
// ADAPTER feeding each axis: the axis itself names the human source
// (`humanEvidence`: analysis / devcase / scorecard / salary_band) and the agent
// source (`agentEvidence`: agent_fit / trial_run / mandate_exchange / budget), so
// the adapter is a lookup on the axis, never a second rubric.
//
// Deliberately NOT a single fused 0-100: blocking coverage and the remaining
// weighted coverage answer different questions and are reported SEPARATELY, and
// the unmet blocking axes are NAMED rather than deducted silently.

export type EvidencePopulation = "human" | "agent";

export type AxisEvidenceSource = RubricAxis["humanEvidence"] | RubricAxis["agentEvidence"];

/** One axis's evidence as a producer recorded it: a score in [0,1] and a pointer
 *  back to the artifact that produced it. */
export type AxisEvidence = { score: number; evidenceRef?: string | null };

/** What the caller holds about ONE candidate, keyed by axis key. An axis with no
 *  entry is "not assessed", never a zero. */
export type CandidateEvidence = {
  population: EvidencePopulation;
  axes: Record<string, AxisEvidence>;
};

/** The ADR-0012 §3 basis row: every axis score carries where it came from. */
export type AxisBasis = {
  axis: string;
  label: string;
  blocking: boolean;
  weight: number;
  /** null ⇒ this candidate has no evidence for the axis yet. */
  score: number | null;
  source: AxisEvidenceSource;
  evidenceRef: string | null;
};

export type RubricEvaluation = {
  rubricVersion: number;
  population: EvidencePopulation;
  basis: AxisBasis[];
  /** Weighted mean score over the BLOCKING axes, in [0,1]; an unassessed blocking
   *  axis counts as 0 (nobody checked it, so it is not met). 0 when the rubric has
   *  no blocking axis — "nothing required" is not "everything met". */
  blockingCoverage: number;
  /** Weighted mean over the non-blocking axes that HAVE evidence, or null when
   *  none does — an absence is not a judgement. */
  otherCoverage: number | null;
  /** Blocking axes with no evidence or a score below BLOCKING_MET_THRESHOLD. */
  unmetBlocking: string[];
  /** Axes with no evidence at all — the board says "not yet assessed" for these. */
  unassessed: string[];
};

/** A blocking axis counts as met at or above this score. */
export const BLOCKING_MET_THRESHOLD = 0.5;

/** The evidence adapter: which producer feeds this axis for this population. */
export function evidenceSourceFor(axis: RubricAxis, population: EvidencePopulation): AxisEvidenceSource {
  return population === "agent" ? axis.agentEvidence : axis.humanEvidence;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/** Judge one candidate against a frozen rubric version. Pure. */
export function evaluateAgainstRubric(
  rubric: { version: number; axes: readonly RubricAxis[] },
  evidence: CandidateEvidence
): RubricEvaluation {
  const basis: AxisBasis[] = rubric.axes.map((axis) => {
    const found = Object.prototype.hasOwnProperty.call(evidence.axes, axis.key) ? evidence.axes[axis.key] : undefined;
    return {
      axis: axis.key,
      label: axis.label,
      blocking: axis.blocking,
      weight: axis.weight,
      score: found ? clamp01(found.score) : null,
      source: evidenceSourceFor(axis, evidence.population),
      evidenceRef: found?.evidenceRef ?? null,
    };
  });
  const weighted = (rows: AxisBasis[]): number | null => {
    const total = rows.reduce((s, r) => s + r.weight, 0);
    return total > 0 ? rows.reduce((s, r) => s + r.weight * (r.score ?? 0), 0) / total : null;
  };
  const blocking = basis.filter((b) => b.blocking);
  return {
    rubricVersion: rubric.version,
    population: evidence.population,
    basis,
    blockingCoverage: weighted(blocking) ?? 0,
    otherCoverage: weighted(basis.filter((b) => !b.blocking && b.score !== null)),
    unmetBlocking: blocking.filter((b) => b.score === null || b.score < BLOCKING_MET_THRESHOLD).map((b) => b.axis),
    unassessed: basis.filter((b) => b.score === null).map((b) => b.axis),
  };
}

/** Same axes, same order, same weights — "would re-deriving change the standard?".
 *  A prose-only brief edit derives identical axes. */
export function sameRubricAxes(a: readonly RubricAxis[], b: readonly RubricAxis[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
