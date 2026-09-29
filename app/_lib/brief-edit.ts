import type { RoleBrief } from "./rolespec";

// Trust boundary for a HUMAN-edited RoleBrief (UAT drain §2.1 —
// PATCH /api/intake/[id]/brief), and the ONE provenance rule behind it.
//
// A brief's product value is defensibility: every requirement, facet and spine
// scalar carries a provenance the panel renders as a chip, so a reviewer can
// tell the lines the hiring manager actually SAID from the lines the model
// guessed. That makes provenance a SERVER-owned field, not a client claim:
// `sanitizeEditedBrief` takes the STORED brief and resolves each row from
// (stored, incoming) — enforcing on the HTTP edit door the same non-regression
// the extraction path already enforces in Python
// (pipeline/jobfit/intake.py::merge_brief — "A stated grading never regresses
// to an inferred one"). The client-side edit diff (`withEditProvenance`) is a
// caller of that same rule, not a second copy of it.
//
// The rest is SHAPE: closed vocabularies, 0..1 clamps, length/entry caps
// mirroring the Python coerce_role_brief floor (pipeline/jobfit/rolebrief.py).
// Pure — no imports beyond the type — so the whole contract is unit-testable
// (brief-edit.test.ts).

const PROVENANCE = ["stated", "inferred", "default"] as const;
// The facet cap the Python merge keeps (intake.py merge_brief). A save that cuts
// lower drops the tail of a brief the dialog legitimately built, silently.
export const MAX_BRIEF_FACETS = 32;

const KINDS = ["must_have", "nice_to_have"] as const;
const HARDNESS = ["prerequisite", "learnable"] as const;
const IMPORTANCE = ["core", "valuable", "context"] as const;
const SENIORITY = ["junior", "medior", "senior", "lead"] as const;

type Provenance = (typeof PROVENANCE)[number];
type Requirement = NonNullable<RoleBrief["requirements"]>[number];
type Facet = NonNullable<RoleBrief["facets"]>[number];

// The spine scalars that carry their own provenance entry, and where each one's
// value lives on the brief (`role_family` is snake_cased on the wire — the map
// is Python-emitted; see RoleBrief.spine_provenance).
const SPINE_KEYS = ["title", "seniority", "role_family"] as const;
const SPINE_VALUE: Record<(typeof SPINE_KEYS)[number], (b: RoleBrief | null) => string> = {
  title: (b) => b?.title ?? "",
  seniority: (b) => b?.seniority ?? "",
  role_family: (b) => b?.roleFamily ?? "",
};

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function vocab<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function clamp01(value: unknown, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : NaN;
  return Number.isNaN(n) ? fallback : Math.min(1, Math.max(0, n));
}

function turn(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function textList(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => text(v, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

// ---------------------------------------------------------------------------
// The provenance rule (shared by the HTTP door and the edit form)
// ---------------------------------------------------------------------------

/** A provenance as it ARRIVES — off the wire, or read back off a stored blob:
 *  the closed vocabulary, or nothing. `null` means "no claim was made", which
 *  is a different fact from a claim of `default`, and that difference is the
 *  whole point of `resolveProvenance`. */
function claim(value: unknown): Provenance | null {
  return typeof value === "string" && (PROVENANCE as readonly string[]).includes(value) ? (value as Provenance) : null;
}

/** THE rule for one row of an edited brief, from (stored, incoming):
 *
 *  - No claim on the wire: an UNCHANGED row keeps what the record already
 *    holds; anything else is unattributed and grades `default`. Never
 *    `stated` — a caller that simply omits provenance must not be able to mint
 *    the requestor's own words onto every line of the brief.
 *  - A claim is honored, EXCEPT that it can never regress a stored `stated`
 *    (merge_brief: "A stated grading never regresses to an inferred one").
 *    Only `stated` is protected, exactly as on the Python side. */
function resolveProvenance(stored: Provenance | null, claimed: Provenance | null, unchanged: boolean): Provenance {
  const next = claimed ?? (unchanged && stored !== null ? stored : "default");
  return stored === "stated" && next !== "stated" ? "stated" : next;
}

/** Whether the row's TRACE (confidence + `sourceTurn`) travels with a
 *  provenance that came from the record rather than from the payload: either
 *  nothing was claimed and nothing was re-graded, or a claim tried to lower a
 *  stored `stated` and lost. In both cases the attribution is the stored one,
 *  so the numbers behind it must be the stored ones too. */
function tracedFromRecord(stored: Provenance | null, claimed: Provenance | null, unchanged: boolean): boolean {
  return claimed === null ? unchanged && stored !== null : stored === "stated" && claimed !== "stated";
}

// Matching between the stored brief and the edited one: requirements by
// lower-cased skill, facets by (key, label). A row absent from the payload was
// DELETED and stays deleted — the rule governs rows that are present.
const requirementKey = (r: Requirement) => (r.skill ?? "").trim().toLowerCase();
const facetKey = (f: Facet) => `${f.key} ${f.label}`;

/** Did the edit leave this requirement's grading alone? `weight` counts: a
 *  grade a human MOVED is the requestor's own call, and leaving weight out of
 *  the comparison let a re-weighted row keep its `inferred` chip. */
function unchangedRequirement(prev: Requirement, next: Requirement): boolean {
  return (
    prev.kind === next.kind &&
    prev.hardness === next.hardness &&
    prev.weight === next.weight &&
    prev.rationale === (next.rationale ?? "")
  );
}

function unchangedFacet(prev: Facet, next: Facet): boolean {
  return prev.value === next.value && prev.importance === next.importance;
}

/** Resolve every provenance on `edited` against the stored brief. Values,
 *  ordering and deletions are the editor's; provenance is the record's. */
function resolveBriefProvenance(original: RoleBrief | null, edited: RoleBrief): RoleBrief {
  const prevReq = new Map((original?.requirements ?? []).map((r) => [requirementKey(r), r] as const));
  const requirements = (edited.requirements ?? []).map((r) => {
    const prev = prevReq.get(requirementKey(r));
    const stored = prev ? claim(prev.provenance) : null;
    const claimed = claim(r.provenance);
    const unchanged = !!prev && unchangedRequirement(prev, r);
    const provenance = resolveProvenance(stored, claimed, unchanged);
    return prev && tracedFromRecord(stored, claimed, unchanged)
      ? { ...r, provenance, confidence: clamp01(prev.confidence, r.confidence), sourceTurn: turn(prev.sourceTurn) }
      : { ...r, provenance };
  });

  const prevFacet = new Map((original?.facets ?? []).map((f) => [facetKey(f), f] as const));
  const facets = (edited.facets ?? []).map((f) => {
    const prev = prevFacet.get(facetKey(f));
    const stored = prev ? claim(prev.provenance) : null;
    const claimed = claim(f.provenance);
    const unchanged = !!prev && unchangedFacet(prev, f);
    const provenance = resolveProvenance(stored, claimed, unchanged);
    return prev && tracedFromRecord(stored, claimed, unchanged)
      ? { ...f, provenance, confidence: clamp01(prev.confidence, f.confidence), sourceTurn: turn(prev.sourceTurn) }
      : { ...f, provenance };
  });

  const spineClaims = edited.spineProvenance ?? {};
  const spineProvenance: Record<string, string> = {};
  for (const key of SPINE_KEYS) {
    const stored = claim(original?.spineProvenance?.[key]);
    const present = key in spineClaims;
    // Nothing on the wire and nothing on the record: the scalar has no
    // provenance to report, and inventing one would chip an empty field.
    if (!present && stored === null) continue;
    const unchanged = SPINE_VALUE[key](edited) === SPINE_VALUE[key](original);
    spineProvenance[key] = resolveProvenance(stored, present ? claim(spineClaims[key]) : null, unchanged);
  }

  return { ...edited, requirements, facets, spineProvenance };
}

/** Client-side provenance CLAIM for a human edit (UAT drain §2.1): a value the
 *  requestor TYPED is `stated` by definition — but only CHANGED or NEW entries
 *  flip; untouched entries keep their original provenance/confidence/sourceTurn
 *  so an edit pass can't launder the whole brief into "stated".
 *
 *  This is the one thing the browser knows and the server cannot infer — that
 *  the diff came out of a form a human typed into. Everything after the claim
 *  is `resolveBriefProvenance`, the same rule the PATCH door runs, so the form
 *  cannot produce an attribution the server would refuse. Pure — unit-tested in
 *  brief-edit.test.ts. */
export function withEditProvenance(original: RoleBrief | null, edited: RoleBrief): RoleBrief {
  const origReq = new Map((original?.requirements ?? []).map((r) => [requirementKey(r), r] as const));
  const requirements = (edited.requirements ?? []).map((r) => {
    const prev = origReq.get(requirementKey(r));
    return prev && unchangedRequirement(prev, r)
      ? { ...r, provenance: prev.provenance, confidence: prev.confidence, sourceTurn: prev.sourceTurn ?? null }
      : { ...r, provenance: "stated" as const, confidence: 1, sourceTurn: prev?.sourceTurn ?? null };
  });
  const origFacet = new Map((original?.facets ?? []).map((f) => [facetKey(f), f] as const));
  const facets = (edited.facets ?? []).map((f) => {
    const prev = origFacet.get(facetKey(f));
    return prev && unchangedFacet(prev, f)
      ? { ...f, provenance: prev.provenance, confidence: prev.confidence, sourceTurn: prev.sourceTurn ?? null }
      : { ...f, provenance: "stated" as const, confidence: 1, sourceTurn: prev?.sourceTurn ?? null };
  });
  const spineProvenance = { ...(edited.spineProvenance ?? {}) };
  if (SPINE_VALUE.title(edited) !== SPINE_VALUE.title(original)) spineProvenance.title = "stated";
  if (SPINE_VALUE.seniority(edited) !== SPINE_VALUE.seniority(original)) spineProvenance.seniority = "stated";
  return resolveBriefProvenance(original, { ...edited, requirements, facets, spineProvenance });
}

/** Sanitize an edited brief against the brief it is replacing. `original` is
 *  the STORED record (null only when the session has no brief yet) and is
 *  required, not optional: provenance cannot be decided without it, and a
 *  caller that had to think about the basis cannot accidentally re-open the
 *  hole where an unattributed payload stamped itself `stated`.
 *
 *  Returns null only when the payload isn't an object at all — a malformed
 *  FIELD degrades per-field (the same floor semantics as the Python coerce),
 *  never rejects the whole edit. */
export function sanitizeEditedBrief(value: unknown, original: RoleBrief | null): RoleBrief | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const requirements = (Array.isArray(raw.requirements) ? raw.requirements : [])
    .map((entry) => {
      const e = (entry ?? {}) as Record<string, unknown>;
      const skill = text(e.skill, 120);
      if (!skill) return null;
      return {
        skill,
        kind: vocab(e.kind, KINDS, "must_have"),
        // An ungraded acquirability falls to the NON-blocking side, as in the
        // Python coerce: must_have x prerequisite is the rubric's blocking cell,
        // and a fallback may not put a row there that nobody graded.
        hardness: vocab(e.hardness, HARDNESS, "learnable"),
        weight: clamp01(e.weight, 0.5),
        rationale: text(e.rationale, 600),
        // A shape-level pass-through: the CLAIM survives sanitizing, and
        // resolveBriefProvenance below decides what it is worth. An absent or
        // off-vocabulary claim stays absent here on purpose — defaulting it to
        // a vocabulary member would erase the "no claim" case the rule needs.
        provenance: text(e.provenance, 20),
        confidence: clamp01(e.confidence, 1),
        sourceTurn: turn(e.sourceTurn),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .slice(0, 24);
  const facets = (Array.isArray(raw.facets) ? raw.facets : [])
    .map((entry) => {
      const e = (entry ?? {}) as Record<string, unknown>;
      const val = text(e.value, 600);
      if (!val) return null;
      return {
        key: text(e.key, 60),
        label: text(e.label, 120),
        value: val,
        importance: vocab(e.importance, IMPORTANCE, "valuable"),
        provenance: text(e.provenance, 20),
        confidence: clamp01(e.confidence, 1),
        sourceTurn: turn(e.sourceTurn),
      };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .slice(0, MAX_BRIEF_FACETS);
  const spineRaw = (raw.spineProvenance ?? {}) as Record<string, unknown>;
  const spineClaims: Record<string, string> = {};
  for (const key of SPINE_KEYS) {
    if (key in spineRaw) spineClaims[key] = text(spineRaw[key], 20);
  }
  return resolveBriefProvenance(original, {
    schemaVersion: 1,
    title: text(raw.title, 120),
    seniority: vocab(raw.seniority, SENIORITY, "medior"),
    roleFamily: text(raw.roleFamily, 60) || "software_engineering",
    languages: textList(raw.languages, 6, 40),
    summary: text(raw.summary, 2000),
    responsibilities: textList(raw.responsibilities, 12, 300),
    successCriteria: textList(raw.successCriteria, 8, 300),
    requirements,
    facets,
    spineProvenance: spineClaims,
    promptVersion: text(raw.promptVersion, 60),
  });
}
