// WHAT THIS TURN CHANGED — the brief diff behind the studio's per-turn arrival.
//
// One exchange returns the WHOLE RoleBrief, not a patch (`/api/intake/[id]/message`
// answers `{reply, brief, …}` and the panel adopts it wholesale). So "the three
// lines that just landed" is not something the wire tells us: it has to be derived
// by comparing the snapshot before the turn with the snapshot after it. That is
// this module, and it is pure — no React, no DOM — so the rules below are pinned by
// `intakeDelta.test.ts` rather than inferred from an animation.
//
// It is deliberately NOT the reveal (`briefReveal.ts`). The reveal answers "how
// should this LINE OF TEXT enter" over the rendered line keys; this answers "which
// ROWS did the turn add, change or drop" over the brief's own arrays, including
// rows the panel renders as something other than a sentence (a spine scalar). The
// two run side by side: the arrival moves the row, the reveal writes the words
// inside it.
//
// Field names are the GENERATED ones (`app/_lib/schemas.generated.ts`, codegen'd
// from `pipeline/jobfit/rolebrief.py`) — camelCase: `successCriteria`,
// `roleFamily`, `sourceTurn`. The Python side spells them with underscores; the
// `section` labels below keep that spelling because they name the brief's
// *sections*, which is the vocabulary the docs and the engine share.
import type { RoleBrief } from "@/app/_lib/rolespec";

/** Which part of the brief a row belongs to. */
export type BriefDeltaSection = "spine" | "requirements" | "success_criteria" | "responsibilities" | "facets";

/** One row of the brief, addressed the way the arrival wiring can find it again:
 *  `key` is the row's stable identity WITHIN its section (see `rowsOf` below), and
 *  `sourceTurn` is the transcript index the engine cited for it — null when the row
 *  carries no citation (every spine field, and any row an older extraction wrote
 *  before `sourceTurn` existed). */
export type BriefRowRef = { section: BriefDeltaSection; key: string; sourceTurn: number | null };

export type BriefDelta = { added: BriefRowRef[]; changed: BriefRowRef[]; removed: BriefRowRef[] };

export const EMPTY_DELTA: BriefDelta = { added: [], changed: [], removed: [] };

/** Identity for a row keyed by its own prose. Same normalization the render walk
 *  uses (`briefSections.ts`), because the two have to agree: the delta's keys are
 *  what the brief body matches its rendered lines against. */
export function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 96);
}

/** A row as the diff sees it: an identity, a citation, and a SIGNATURE of
 *  everything else it carries. Two rows with the same key and different signatures
 *  are the same row, changed. */
type Row = { key: string; sourceTurn: number | null; signature: string };

/** The spine scalars, in the order the brief presents them. `languages` is an
 *  array but reads as one line, so it is diffed as one value. */
const SPINE_FIELDS = ["title", "seniority", "roleFamily", "summary", "languages"] as const;

function spineValue(brief: RoleBrief, field: (typeof SPINE_FIELDS)[number]): string {
  if (field === "languages") return (brief.languages ?? []).join(" · ");
  return (brief[field] ?? "").trim();
}

function spineRows(brief: RoleBrief): Row[] {
  return SPINE_FIELDS.map((field) => ({ field, value: spineValue(brief, field) }))
    // An EMPTY scalar is an absent row, not a row holding "". Otherwise clearing a
    // summary would read as a change and filling one for the first time would not
    // read as an arrival.
    .filter((f) => f.value !== "")
    .map((f) => ({ key: f.field, sourceTurn: null, signature: f.value }));
}

function requirementRows(brief: RoleBrief): Row[] {
  return (brief.requirements ?? [])
    .filter((r) => (r.skill ?? "").trim() !== "")
    .map((r) => ({
      key: normalizeKey(r.skill ?? ""),
      sourceTurn: r.sourceTurn ?? null,
      // Everything a requirement claims BESIDES its name — the grading is what a
      // re-extraction most often moves, and moving it is a change worth showing.
      signature: [r.kind, r.hardness, r.weight, r.provenance, r.confidence, r.rationale].join("␟"),
    }));
}

function facetRows(brief: RoleBrief): Row[] {
  return (brief.facets ?? [])
    .filter((f) => (f.key ?? "").trim() !== "")
    .map((f) => ({
      // A facet has a real key of its own (`budget_band`, `objective:<kpi>`), so it
      // is identified by that rather than by its prose — which is exactly the field
      // a correction rewrites.
      key: f.key ?? "",
      sourceTurn: f.sourceTurn ?? null,
      signature: [f.label, f.value, f.importance, f.provenance, f.confidence].join("␟"),
    }));
}

function textRows(values: readonly string[] | undefined): Row[] {
  return (values ?? [])
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map((s) => ({ key: normalizeKey(s), sourceTurn: null, signature: s }));
}

function rowsOf(brief: RoleBrief | null): Record<BriefDeltaSection, Row[]> {
  const b = brief ?? {};
  return {
    spine: spineRows(b),
    requirements: requirementRows(b),
    success_criteria: textRows(b.successCriteria),
    responsibilities: textRows(b.responsibilities),
    facets: facetRows(b),
  };
}

const ref = (section: BriefDeltaSection, row: Row): BriefRowRef => ({
  section,
  key: row.key,
  sourceTurn: row.sourceTurn,
});

/**
 * Diff one section.
 *
 * Keyed first, POSITIONAL second. The keyed pass is the honest one: same key →
 * same row, so a re-extraction that re-orders the array moves nothing on screen.
 * The positional pass exists because a whole class of edits destroys the key — a
 * requirement renamed from "React" to "React Native", a 90-day criterion
 * rephrased — and a keyed diff alone reports those as a deletion plus an
 * unrelated arrival, which is the one story that is definitely wrong. So: when a
 * key vanishes at index i AND a key nobody has seen appears at index i, the two
 * are the same row, changed. It is pinned by the test because it is a heuristic;
 * it applies only at the SAME index, so a genuine insert above a genuine delete
 * still reads as both.
 */
function diffSection(section: BriefDeltaSection, prev: Row[], next: Row[]): BriefDelta {
  const prevAt = new Map<string, number>();
  prev.forEach((r, i) => {
    if (!prevAt.has(r.key)) prevAt.set(r.key, i);
  });
  const nextKeys = new Set(next.map((r) => r.key));

  const changed: BriefRowRef[] = [];
  const appeared: { row: Row; index: number }[] = [];
  next.forEach((row, index) => {
    const at = prevAt.get(row.key);
    if (at === undefined) appeared.push({ row, index });
    else if (prev[at]?.signature !== row.signature) changed.push(ref(section, row));
  });

  const vanished = prev
    .map((row, index) => ({ row, index }))
    .filter((e) => !nextKeys.has(e.row.key));
  const vanishedAt = new Map(vanished.map((e) => [e.index, e]));

  const matched = new Set<number>();
  const added: BriefRowRef[] = [];
  for (const a of appeared) {
    const gone = vanishedAt.get(a.index);
    if (gone && !matched.has(gone.index)) {
      matched.add(gone.index);
      changed.push(ref(section, a.row));
    } else {
      added.push(ref(section, a.row));
    }
  }

  return {
    added,
    changed,
    removed: vanished.filter((e) => !matched.has(e.index)).map((e) => ref(section, e.row)),
  };
}

/**
 * What one turn did to the brief. `prev === null` — the first snapshot this
 * surface ever saw — makes every row an arrival, each carrying its own cited
 * turn, which is what lets a session opened mid-conversation still show where its
 * content came from.
 */
export function diffBrief(prev: RoleBrief | null, next: RoleBrief): BriefDelta {
  const before = rowsOf(prev);
  const after = rowsOf(next);
  const out: BriefDelta = { added: [], changed: [], removed: [] };
  for (const section of Object.keys(after) as BriefDeltaSection[]) {
    const part = diffSection(section, before[section], after[section]);
    out.added.push(...part.added);
    out.changed.push(...part.changed);
    out.removed.push(...part.removed);
  }
  return out;
}

/**
 * The same question for the JD draft, which is markdown rather than rows: which
 * LINE INDEXES of the new document are new, and which replaced something.
 *
 * Deliberately not an LCS. The draft is regenerated deterministically from the
 * brief on every turn (`briefDraftMarkdown`), so its lines move in blocks and a
 * minimal edit script buys nothing a reader would notice — while costing the
 * quadratic table and a second definition of "same line". A line whose text was
 * not in the previous document is NEW; if the slot it now occupies held a line
 * that is gone from the document entirely, it REPLACED it. Blank lines carry no
 * content and are never reported.
 *
 * Counted, not set-tested: a posting legitimately repeats a line ("—", a bare
 * heading), and a set would call the second copy of a duplicated line an arrival.
 */
export function diffDraft(prevLines: readonly string[], nextLines: readonly string[]): { added: number[]; changed: number[] } {
  const budget = new Map<string, number>();
  for (const raw of prevLines) {
    const line = raw.trim();
    if (!line) continue;
    budget.set(line, (budget.get(line) ?? 0) + 1);
  }
  const survives = new Set(nextLines.map((l) => l.trim()).filter(Boolean));

  const added: number[] = [];
  const changed: number[] = [];
  nextLines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const left = budget.get(line) ?? 0;
    if (left > 0) {
      budget.set(line, left - 1);
      return;
    }
    const displaced = (prevLines[index] ?? "").trim();
    if (displaced && !survives.has(displaced)) changed.push(index);
    else added.push(index);
  });
  return { added, changed };
}
