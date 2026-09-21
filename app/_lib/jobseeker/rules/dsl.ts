// Validation of an extraction-rule set BEFORE it touches the engine or the store.
//
// The vocabulary is the wire's (types.ts: RULE_FIELDS, LOCATOR_KINDS, RULE_POST_OPS);
// this module only decides whether a submitted array is a rule set at all. It runs
// on the model's proposal (rules/propose route) and on the owner's edit (PATCH), so
// a rule the engine cannot run never reaches either the preview or a scan.

import {
  LOCATOR_KINDS,
  RULE_FIELDS,
  RULE_POST_OPS,
  type ExtractionRule,
  type LocatorKind,
  type RuleField,
  type RulePostOp,
} from "../types";

export const MAX_RULES = 30;
export const MAX_EXPR_CHARS = 500;

export type RulesValidation = ExtractionRule[] | { error: string };

export function isRulesError(v: RulesValidation): v is { error: string } {
  return !Array.isArray(v);
}

function isField(v: unknown): v is RuleField {
  return typeof v === "string" && (RULE_FIELDS as readonly string[]).includes(v);
}
function isLocatorKind(v: unknown): v is LocatorKind {
  return typeof v === "string" && (LOCATOR_KINDS as readonly string[]).includes(v);
}
function isPostOp(v: unknown): v is RulePostOp {
  return typeof v === "string" && (RULE_POST_OPS as readonly string[]).includes(v);
}

/** A regex locator must compile and carry exactly ONE capture group — the value. */
export function regexCaptureGroups(expr: string): number | null {
  try {
    // The empty alternative trick counts groups without running the pattern on input.
    return new RegExp(`${expr}|`).exec("")!.length - 1;
  } catch {
    return null;
  }
}

function validateOne(raw: unknown, index: number): ExtractionRule | { error: string } {
  const at = `rules[${index}]`;
  if (!raw || typeof raw !== "object") return { error: `${at}: not an object` };
  const r = raw as Record<string, unknown>;
  if (!isField(r.field)) return { error: `${at}.field: must be one of ${RULE_FIELDS.join(", ")}` };
  const loc = r.locator as Record<string, unknown> | undefined;
  if (!loc || typeof loc !== "object") return { error: `${at}.locator: missing` };
  if (!isLocatorKind(loc.kind)) return { error: `${at}.locator.kind: must be one of ${LOCATOR_KINDS.join(", ")}` };
  if (typeof loc.expr !== "string" || !loc.expr.trim()) return { error: `${at}.locator.expr: required` };
  if (loc.expr.length > MAX_EXPR_CHARS) return { error: `${at}.locator.expr: over ${MAX_EXPR_CHARS} characters` };
  if (loc.attr !== undefined && (typeof loc.attr !== "string" || !/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(loc.attr))) {
    return { error: `${at}.locator.attr: not an attribute name` };
  }
  if (loc.kind === "regex") {
    const groups = regexCaptureGroups(loc.expr);
    if (groups === null) return { error: `${at}.locator.expr: regex does not compile` };
    if (groups !== 1) return { error: `${at}.locator.expr: regex must have exactly one capture group (has ${groups})` };
  }
  if (loc.kind === "pointer" && !loc.expr.startsWith("/")) return { error: `${at}.locator.expr: a JSON pointer starts with /` };
  if (loc.kind !== "css" && loc.attr !== undefined) return { error: `${at}.locator.attr: only a css locator takes an attribute` };
  if (r.cardinality !== "one" && r.cardinality !== "many") return { error: `${at}.cardinality: one | many` };
  if (r.pick !== "first" && r.pick !== "last" && r.pick !== "fail") return { error: `${at}.pick: first | last | fail` };
  if (!Array.isArray(r.post) || !r.post.every(isPostOp)) return { error: `${at}.post: an array of ${RULE_POST_OPS.join(", ")}` };
  if (typeof r.required !== "boolean") return { error: `${at}.required: boolean` };
  return {
    field: r.field,
    locator: { kind: loc.kind, expr: loc.expr, ...(typeof loc.attr === "string" ? { attr: loc.attr } : {}) },
    cardinality: r.cardinality,
    pick: r.pick,
    post: r.post as RulePostOp[],
    required: r.required,
  };
}

/** The whole set: shape per rule, one rule per field, and the two identity
 *  invariants — a `url` rule exists and is required (it is how a listing row becomes
 *  a posting), and an `externalKey` rule, when present, is required too (a key that
 *  is sometimes missing would split one posting into two rows). */
export function validateRules(rules: unknown): RulesValidation {
  if (!Array.isArray(rules)) return { error: "rules: must be an array" };
  if (rules.length === 0) return { error: "rules: at least one rule" };
  if (rules.length > MAX_RULES) return { error: `rules: at most ${MAX_RULES} rules` };
  const out: ExtractionRule[] = [];
  const seen = new Set<RuleField>();
  for (let i = 0; i < rules.length; i++) {
    const v = validateOne(rules[i], i);
    if ("error" in v) return v;
    if (seen.has(v.field)) return { error: `rules[${i}].field: ${v.field} appears twice` };
    seen.add(v.field);
    out.push(v);
  }
  const url = out.find((r) => r.field === "url");
  if (!url) return { error: "rules: a url rule is required" };
  if (!url.required) return { error: "rules: the url rule must be required" };
  const key = out.find((r) => r.field === "externalKey");
  if (key && !key.required) return { error: "rules: an externalKey rule must be required" };
  return out;
}
