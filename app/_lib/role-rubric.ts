import type { RubricAxis } from "./schemas.generated";
import type { RoleBrief } from "./rolespec";

// The role-rubric derivation (ADR-0010 §2) for the TS callers — a line-for-line
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
