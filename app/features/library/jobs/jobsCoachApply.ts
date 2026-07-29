// winnability-apply — the compact, one-shot URL grammar that lets a winnability
// coach recommendation ("loosen German → +4 eligible", "demote must-have X → +2
// qualified") hand off into the EXISTING JD editor with the change staged for the
// recruiter to confirm. The coach itself stays deliberately read-only (it never
// mutates the job); this only pre-stages a SUGGESTION in the editor the recruiter
// already trusts — nothing is auto-saved.
//
// Mirrors the group-eval-arm.ts precedent: pure + dependency-free so both ends of
// the deep link — CoachPanel (builds it) and the Library ledger (consumes it) —
// share one grammar, shape-validated at the boundary, unit-testable without React.
//
// The value is weak-trust: it only pre-selects a JD row and paints a suggestion
// banner. The recruiter still edits the free-text JD body themselves and saves
// through the editor's existing CAS/conflict path (which re-ingests the linked
// job). A malformed param stages nothing — fail-closed.

/** The tab-scoped query param carrying the staged edit (see tabs.ts allowlist). */
export const COACH_EDIT_PARAM = "coachEdit";

// The three recommendation kinds the coach can hand off. Salary is deliberately
// absent: the matchable band is fixed to the grounded market analysis, so editing
// the JD wording can't move it — a salary row honestly carries no apply affordance.
export type CoachEditKind = "language" | "education" | "mustHave";

export type CoachEdit = {
  kind: CoachEditKind;
  /** The JD slug to open in the editor (jdSlugOfJobId of the graded job). */
  slug: string;
  /** The projected candidate gain (the coach's "+N"); 0 when unknown. */
  delta: number;
  /** The requirement to loosen — a language, an education floor, or a skill. */
  value: string;
};

const KINDS: readonly CoachEditKind[] = ["language", "education", "mustHave"];
// JD slugs are minted from the same alphabet as pipeline ids (see group-eval-arm);
// keep the guard permissive over that set but bounded so junk never round-trips.
const SLUG_RE = /^[A-Za-z0-9_-]{1,120}$/;
// Strip Unicode control chars (the \p{Cc} category) before length-capping a value.
const CONTROL_RE = /\p{Cc}/gu;
const VALUE_MAX = 80;
const DELTA_MAX = 9999;
// Field separator. Only `value` is free text and it is serialized LAST, so a `~`
// inside a requirement name is preserved on parse (slice-and-rejoin below) rather
// than breaking the field count.
const SEP = "~";

function isKind(v: string): v is CoachEditKind {
  return (KINDS as readonly string[]).includes(v);
}

/** Normalize a free-text requirement value: strip control chars, collapse
 *  whitespace, cap length. Empty after cleaning ⟹ nothing to stage. */
function cleanValue(raw: string): string {
  return raw.replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim().slice(0, VALUE_MAX);
}

function clampDelta(n: number): number {
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 0), DELTA_MAX) : 0;
}

/** Serialize a coach recommendation into the `coachEdit` value, or null when the
 *  edit is not stageable (bad kind/slug, or an empty requirement value). */
export function buildCoachEditParam(edit: CoachEdit): string | null {
  if (!isKind(edit.kind)) return null;
  if (!SLUG_RE.test(edit.slug)) return null;
  const value = cleanValue(edit.value);
  if (!value) return null;
  return [edit.kind, edit.slug, String(clampDelta(edit.delta)), value].join(SEP);
}

/** Parse an incoming `coachEdit` value into a validated CoachEdit, or null when
 *  the param is absent/malformed — a bad handoff must stage nothing. */
export function parseCoachEditParam(raw: string | null | undefined): CoachEdit | null {
  if (!raw) return null;
  const parts = raw.split(SEP);
  if (parts.length < 4) return null;
  const [kind, slug, deltaRaw] = parts;
  // value is last: rejoin any `~` that lived inside a requirement name.
  const value = cleanValue(parts.slice(3).join(SEP));
  if (!isKind(kind)) return null;
  if (!SLUG_RE.test(slug)) return null;
  if (!value) return null;
  const delta = /^\d{1,4}$/.test(deltaRaw) ? clampDelta(Number(deltaRaw)) : 0;
  return { kind, slug, delta, value };
}
