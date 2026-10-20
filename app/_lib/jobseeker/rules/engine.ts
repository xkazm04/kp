// The rule engine: the ONLY consumer of linkedom in this tree (ADR 0009 §1).
//
// Model-as-author, engine-as-extractor: a rule set is authored once per page shape
// (by the owner, or proposed by the LLM from the real markup) and this module runs it
// deterministically on every listing page. Four locator kinds, one value model:
//
//   css      querySelectorAll(expr) → textContent, or the named attribute
//   regex    one capture group over the raw HTML, global
//   jsonld   a dotted path into the page's schema.org JobPosting object
//   pointer  a JSON pointer (RFC 6901) into the first <script type="application/json">
//
// Items are COLUMN-ORIENTED: every `many` rule yields a column, item i is the i-th
// value of each column, and a `one` rule broadcasts to every item. That is the shape
// of a listing page — N cards, each with a title, a link, a company — and it keeps
// the DSL free of a card-scope selector (a rule that misaligns shows up in the
// preview as a wrong company on the wrong title, which is what the preview is for).

import { parseHTML } from "linkedom";
import { decodeEntities, htmlToText } from "../../job-posting-fetch";
import type { ExtractionRule, RuleDryRunResult, RuleField, RuleVerdict } from "../types";
import { hasNestedQuantifier } from "./dsl";

/** The most matches one regex locator collects from one page (empty matches included). */
export const MAX_REGEX_MATCHES = 1000;

export type RuleItems = Record<RuleField, string | string[] | null>[];

export type RunRulesResult = { items: RuleItems; perRule: RuleDryRunResult[] };

const SAMPLE_COUNT = 3;

// --- JSON-LD and embedded JSON ------------------------------------------------

function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null; /* a broken script block is simply not a source of values */
  }
}

/** Every JSON-LD block on the page, flattened through `@graph`. */
export function jsonLdObjects(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const parsed = parseJsonLoose(m[1].trim());
    const stack: unknown[] = Array.isArray(parsed) ? [...parsed] : parsed ? [parsed] : [];
    while (stack.length) {
      const node = stack.shift();
      if (!node || typeof node !== "object") continue;
      const obj = node as Record<string, unknown>;
      if (Array.isArray(obj["@graph"])) stack.push(...(obj["@graph"] as unknown[]));
      out.push(obj);
    }
  }
  return out;
}

function typeOf(obj: Record<string, unknown>): string[] {
  const t = obj["@type"];
  return Array.isArray(t) ? t.map(String) : typeof t === "string" ? [t] : [];
}

/** The page's JobPosting object, when it carries one. */
export function findJobPosting(html: string): Record<string, unknown> | null {
  return jsonLdObjects(html).find((o) => typeOf(o).includes("JobPosting")) ?? null;
}

function firstJsonScript(html: string): unknown {
  const m = /<script\b[^>]*type\s*=\s*["']application\/json["'][^>]*>([\s\S]*?)<\/script\s*>/i.exec(html);
  return m ? parseJsonLoose(m[1].trim()) : null;
}

function dottedPath(root: unknown, path: string): unknown {
  let cur = root;
  for (const seg of path.split(".").filter(Boolean)) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function jsonPointer(root: unknown, pointer: string): unknown {
  if (pointer === "" || pointer === "/") return root;
  let cur = root;
  for (const raw of pointer.split("/").slice(1)) {
    const seg = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function scalarize(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function toValues(resolved: unknown, many: boolean): string[] {
  if (resolved === undefined || resolved === null) return [];
  if (Array.isArray(resolved)) {
    const flat = resolved.map(scalarize).filter((v): v is string => v !== null);
    return many ? flat : flat.slice(0, 1);
  }
  const one = scalarize(resolved);
  return one === null ? [] : [one];
}

// --- post ops ----------------------------------------------------------------------

function parseNumber(v: string): string | null {
  const m = /-?\d[\d\s .,]*/.exec(v);
  if (!m) return null;
  const digits = m[0].replace(/[\s ]/g, "");
  // "90 000" / "90.000" / "90,000" are thousands; a trailing ",50" or ".50" is decimal.
  const normalized = /[.,]\d{1,2}$/.test(digits) ? digits.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".") : digits.replace(/[.,]/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? String(n) : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** ISO date or null. Accepts ISO 8601, `d. m. yyyy` / `d.m.yyyy` / `d/m/yyyy`, and
 *  the RFC 2822 shape RSS uses. A relative phrase ("před 2 dny") is NOT guessed. */
export function toIsoDate(v: string): string | null {
  const s = v.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const rfc = /^(?:\w{3},\s*)?(\d{1,2})\s+(\w{3})\w*\s+(\d{4})/.exec(s);
  if (rfc && MONTHS[rfc[2].toLowerCase()]) return `${rfc[3]}-${String(MONTHS[rfc[2].toLowerCase()]).padStart(2, "0")}-${rfc[1].padStart(2, "0")}`;
  const t = Date.parse(s);
  return Number.isFinite(t) && /\d{4}/.test(s) ? new Date(t).toISOString().slice(0, 10) : null;
}

function applyPost(value: string, ops: ExtractionRule["post"], baseUrl: string): string | null {
  let v: string | null = value;
  for (const op of ops) {
    if (v === null) return null;
    switch (op) {
      case "trim":
        v = v.replace(/\s+/g, " ").trim();
        break;
      case "text":
        v = /<[a-z!/]/i.test(v) ? htmlToText(v) : decodeEntities(v).replace(/\s+/g, " ").trim();
        break;
      case "absUrl":
        try {
          v = new URL(v.trim(), baseUrl).href;
        } catch {
          v = null; /* not a URL — the rule missed, and a miss is a null, never a throw */
        }
        break;
      case "number":
        v = parseNumber(v);
        break;
      case "date":
        v = toIsoDate(v);
        break;
    }
  }
  return v === "" ? null : v;
}

// --- the run ------------------------------------------------------------------------

type Located = { values: string[] };

function locate(rule: ExtractionRule, ctx: { html: string; document: Document | null; jobPosting: Record<string, unknown> | null; jsonScript: unknown }): Located {
  const many = rule.cardinality === "many";
  switch (rule.locator.kind) {
    case "css": {
      if (!ctx.document) return { values: [] };
      let nodes: Element[];
      try {
        nodes = Array.from(ctx.document.querySelectorAll(rule.locator.expr));
      } catch {
        return { values: [] }; /* an invalid selector is a miss the dry run reports, not a crash */
      }
      const attr = rule.locator.attr;
      const values = nodes
        .map((el) => (attr ? el.getAttribute(attr) : el.textContent))
        .filter((v): v is string => typeof v === "string");
      return { values };
    }
    case "regex": {
      // A rule stored before validation refused nested quantifiers is a miss, never run:
      // it would backtrack over a third party's page on the scan thread.
      if (hasNestedQuantifier(rule.locator.expr)) return { values: [] };
      const re = new RegExp(rule.locator.expr, "g");
      const values: string[] = [];
      let m: RegExpExecArray | null;
      let matches = 0;
      while ((m = re.exec(ctx.html)) !== null) {
        if (m[1] !== undefined) values.push(m[1]);
        if (m[0] === "") re.lastIndex += 1;
        if (!many && values.length) break;
        // A listing page is tens of cards; a pattern matching thousands of times is
        // matching noise, and each match is a string held for the whole run.
        if (++matches >= MAX_REGEX_MATCHES) break;
      }
      return { values };
    }
    case "jsonld":
      return { values: toValues(dottedPath(ctx.jobPosting, rule.locator.expr), many) };
    case "pointer":
      return { values: toValues(jsonPointer(ctx.jsonScript, rule.locator.expr), many) };
  }
}

export function runRules(rules: ExtractionRule[], html: string, baseUrl: string): RunRulesResult {
  const needsDom = rules.some((r) => r.locator.kind === "css");
  const document = needsDom ? (parseHTML(html).document as unknown as Document) : null;
  const ctx = {
    html,
    document,
    jobPosting: rules.some((r) => r.locator.kind === "jsonld") ? findJobPosting(html) : null,
    jsonScript: rules.some((r) => r.locator.kind === "pointer") ? firstJsonScript(html) : null,
  };
  const columns = new Map<RuleField, { values: string[]; broadcast: boolean }>();
  const perRule: RuleDryRunResult[] = [];
  for (const rule of rules) {
    const raw = locate(rule, ctx).values;
    const matched = raw.length;
    let values = raw.map((v) => applyPost(v, rule.post, baseUrl)).filter((v): v is string => v !== null);
    let verdict: RuleVerdict = "hit";
    if (matched === 0) {
      verdict = rule.required ? "miss-required" : "miss-optional";
    } else if (rule.cardinality === "one" && matched > 1) {
      if (rule.pick === "fail") {
        verdict = "ambiguous";
        values = [];
      } else {
        values = rule.pick === "last" ? values.slice(-1) : values.slice(0, 1);
      }
    }
    perRule.push({ field: rule.field, matched, samples: values.slice(0, SAMPLE_COUNT), verdict });
    columns.set(rule.field, { values, broadcast: rule.cardinality === "one" });
  }
  const rowCount = Math.max(0, ...[...columns.values()].filter((c) => !c.broadcast).map((c) => c.values.length));
  const items: RuleItems = [];
  // A page with only `one` rules (a detail page) is a single item.
  const total = rowCount || ([...columns.values()].some((c) => c.broadcast && c.values.length) ? 1 : 0);
  for (let i = 0; i < total; i++) {
    const item = {} as Record<RuleField, string | string[] | null>;
    for (const [field, col] of columns) {
      item[field] = col.broadcast ? col.values[0] ?? null : col.values[i] ?? null;
    }
    items.push(item);
  }
  return { items, perRule };
}

/** The preview: the same run, nothing written, samples capped per rule. */
export function dryRun(rules: ExtractionRule[], html: string, baseUrl: string): RunRulesResult {
  return runRules(rules, html, baseUrl);
}
