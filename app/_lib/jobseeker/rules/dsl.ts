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

/** The length of an UNBOUNDED quantifier (`*`, `+`, `{n,}`, each optionally lazy) at
 *  `i`, or 0. `?` and `{n}` / `{n,m}` are bounded and do not count. */
function unboundedQuantifierAt(expr: string, i: number): number {
  const c = expr[i];
  let len = 0;
  if (c === "*" || c === "+") len = 1;
  else if (c === "{") {
    const m = /^\{\d+,\}/.exec(expr.slice(i, i + 12));
    if (m) len = m[0].length;
  }
  if (len && expr[i + len] === "?") len += 1;
  return len;
}

/** Does the pattern repeat a group that itself repeats — `(a+)+`, `(?:x*)*`,
 *  `((?:\w+\s?)*)` — the shape that backtracks exponentially on a near-miss? A
 *  scanner over the pattern text (escapes and character classes skipped), not a
 *  full regex parser: it can only refuse a pattern, and what it refuses is exactly
 *  the form an owner or a model never needs to pull one value out of a page. */
export function hasNestedQuantifier(expr: string): boolean {
  // One frame per open group: does anything inside it repeat without bound?
  const stack: boolean[] = [false];
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "\\") {
      i += 1; // an escaped char is one atom
      continue;
    }
    if (c === "[") {
      // A class is one atom; `]` right after `[` or `[^` is literal.
      let j = i + 1;
      if (expr[j] === "^") j += 1;
      if (expr[j] === "]") j += 1;
      while (j < expr.length && expr[j] !== "]") j += expr[j] === "\\" ? 2 : 1;
      i = j;
      continue;
    }
    if (c === "(") {
      stack.push(false);
      continue;
    }
    if (c === ")") {
      const innerRepeats = stack.length > 1 ? stack.pop()! : false;
      const q = unboundedQuantifierAt(expr, i + 1);
      if (q && innerRepeats) return true;
      if (q || innerRepeats) stack[stack.length - 1] = true;
      i += q;
      continue;
    }
    const q = unboundedQuantifierAt(expr, i);
    if (q) {
      stack[stack.length - 1] = true;
      i += q - 1;
    }
  }
  return false;
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
    // The page is a third party's text: a pattern that can backtrack exponentially on
    // it stalls the scan thread (the regex runs synchronously over the whole HTML).
    if (hasNestedQuantifier(loc.expr)) return { error: `${at}.locator.expr: a nested quantifier like (a+)+ can backtrack without bound; flatten it` };
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
