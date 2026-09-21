// The live brief, flattened into SECTIONS OF IDENTIFIED LINES.
//
// The shipped body (JdsIntakeBriefBody.tsx) walks the brief's four shapes
// inline, which is fine for drawing it once — but a reveal has to answer a
// question the inline walk cannot: "is this line new?". That needs a stable
// identity per line, held across the re-render that a fresh extraction causes.
//
// So identity is derived from the line's own TEXT, not its array index: the
// engine re-emits the whole brief on every sweep and an index shifts whenever
// anything lands above it. Same sentence → same key → the reader sees it stay
// put; a genuinely new sentence gets a key nobody has seen and types itself in
// (briefReveal.ts decides which is which).
//
// Pure and view-free on purpose: two prototype variants and the reveal hook all
// read the same list, and the test can assert identity without a DOM.
import type { RoleBrief } from "@/app/_lib/rolespec";
import { normalizeKey } from "./intakeDelta";
import { prepareFacets, sortByWeight, type BriefRequirement } from "./jdsIntakeBriefModel";

export type BriefSectionKind = "outcomes" | "musts" | "nices" | "facets";

export type BriefLine = {
  /** Stable across re-extractions — see the header. */
  key: string;
  /** The same row's identity in the BRIEF DIFF (`intakeDelta.ts`), which is not
   *  `key`: the render key encodes the section and disambiguates duplicates,
   *  while the diff keys a row by what the engine calls it (a normalized skill or
   *  sentence, a facet's own key). Carried here so the arrival wiring can ask
   *  "did this row just land?" without re-deriving either identity. */
  arrivalId: string;
  /** The sentence itself: the part that types. */
  text: string;
  /** A facet's field name (`Team`, `Budget`); null for the other kinds, whose
   *  text IS the whole line. Never typed — a label is chrome, not content. */
  label: string | null;
  provenance: string | null;
  confidence: number | null;
  sourceTurn: number | null;
  /** The source requirement, so a view can still draw its rationale disclosure. */
  requirement: BriefRequirement | null;
  learnable: boolean;
  /** Background, not foreground (a `context`-graded facet) — the view drops it
   *  to steel exactly as the shipped body does. */
  muted: boolean;
};

export type BriefSection = {
  key: string;
  kind: BriefSectionKind;
  /** Facet sections only: the group key the view translates into a heading. */
  groupKey: string | null;
  /** The section's hue block — colour is the SECTION here, never the row. */
  hue: string;
  lines: BriefLine[];
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 96);
}

/** Two lines can legitimately carry the same words (the same skill named as a
 *  must and as a nice, one facet value repeated across groups). A counter keeps
 *  their keys distinct AND deterministic — the Nth duplicate is always `#N`, so
 *  a rebuild of an unchanged brief produces byte-identical keys. */
function keyer() {
  const used = new Map<string, number>();
  return (prefix: string, text: string): string => {
    const base = `${prefix}:${normalize(text)}`;
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  };
}

function requirementLine(r: BriefRequirement, key: string): BriefLine {
  return {
    key,
    arrivalId: normalizeKey(r.skill ?? ""),
    text: r.skill ?? "",
    label: null,
    provenance: r.provenance ?? null,
    confidence: r.confidence ?? null,
    sourceTurn: r.sourceTurn ?? null,
    requirement: r,
    learnable: r.hardness === "learnable",
    muted: false,
  };
}

export function buildBriefSections(brief: RoleBrief | null): BriefSection[] {
  if (!brief) return [];
  const key = keyer();
  const sections: BriefSection[] = [];

  const outcomes = brief.successCriteria ?? [];
  if (outcomes.length > 0) {
    sections.push({
      key: "outcomes",
      kind: "outcomes",
      groupKey: null,
      hue: "bg-moss",
      lines: outcomes.map((s) => ({
        key: key("outcome", s),
        arrivalId: normalizeKey(s),
        text: s,
        label: null,
        provenance: null,
        confidence: null,
        sourceTurn: null,
        requirement: null,
        learnable: false,
        muted: false,
      })),
    });
  }

  const requirements = brief.requirements ?? [];
  const musts = sortByWeight(requirements.filter((r) => r.kind === "must_have"));
  if (musts.length > 0) {
    sections.push({
      key: "musts",
      kind: "musts",
      groupKey: null,
      hue: "bg-coral",
      lines: musts.map((r) => requirementLine(r, key("must", r.skill ?? ""))),
    });
  }

  const nices = sortByWeight(requirements.filter((r) => r.kind === "nice_to_have"));
  if (nices.length > 0) {
    sections.push({
      key: "nices",
      kind: "nices",
      groupKey: null,
      hue: "bg-steel",
      lines: nices.map((r) => ({ ...requirementLine(r, key("nice", r.skill ?? "")), learnable: false })),
    });
  }

  for (const group of prepareFacets(brief)) {
    sections.push({
      key: `facets:${group.key}`,
      kind: "facets",
      groupKey: group.key,
      hue: "bg-stone-300",
      lines: group.items.map((f) => ({
        key: key(`facet:${group.key}`, `${f.label || f.key} ${f.displayValue}`),
        arrivalId: f.key ?? "",
        text: f.displayValue,
        label: f.label || f.key,
        provenance: f.provenance ?? null,
        confidence: f.confidence ?? null,
        sourceTurn: f.sourceTurn ?? null,
        requirement: null,
        learnable: false,
        muted: f.importance === "context",
      })),
    });
  }

  return sections;
}

/** Every line key in render order — what the reveal hook diffs on. */
export function sectionLineKeys(sections: readonly BriefSection[]): string[] {
  return sections.flatMap((s) => s.lines.map((l) => l.key));
}
