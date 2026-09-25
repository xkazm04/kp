/*
 * The style-debt matchers — ONE definition, read by two callers:
 *
 *   style-debt.test.ts            the ratchet (whole tree, `npm run test:unit`)
 *   scripts/style/lint-edited.mjs the advisory edit-time hook (one file)
 *
 * Kept apart from both so the hook can never disagree with the gate about what
 * a violation is. Erasable TypeScript only: the hook imports this file straight
 * from a `.mjs` under node's built-in type stripping.
 *
 * JSX-AWARE ON PURPOSE. A line regex reads comments, JSX prose ("Don't…") and
 * i18n text as if they were class strings, and cannot tell one `<button` from
 * the `button` inside a prop name. So the source is parsed with the TypeScript
 * compiler (already a dependency) and the rules read two things only:
 *
 *   class tokens   every string / template-literal piece in the file, split on
 *                  whitespace, with variant prefixes (`dark:`, `hover:`, `!`)
 *                  stripped — `dark:text-xs` IS `text-xs`. Comments and JSX
 *                  text are never visited.
 *   elements       `<button>`, `<header>` and `<table>` JSX elements.
 *
 * Counts are per OCCURRENCE (token or element), not per line.
 */
import ts from "typescript";
import { readFileSync } from "node:fs";

export const STYLE_RULES = [
  "below-floor-text",
  "arbitrary-text-size",
  "raw-text-size",
  "raw-stone-text",
  "raw-status-hue",
  "raw-button",
  "bare-rounded",
  "literal-page-header",
  "raw-table",
] as const;

export type StyleRule = (typeof STYLE_RULES)[number];
export type StyleCounts = Partial<Record<StyleRule, number>>;

/** One-line remedy per rule, printed by the gate and by the hook. */
export const STYLE_REMEDY: Record<StyleRule, string> = {
  "below-floor-text": "below the 14px floor - use text-meta / text-micro (docs/design/README.md Type & motion)",
  "arbitrary-text-size": "arbitrary text-[length] - use a type token (display / h2 / h3 / body / meta / micro)",
  "raw-text-size": "raw text-sm/base/lg/xl… - use the type token for that step (text-meta, text-body, text-h3 …)",
  "raw-stone-text": "text-stone-N - use a role token (text-ink / text-steel)",
  "raw-status-hue": "raw palette hue - use a brand token (coral / moss / steel / dial-amber) or NOTICE(tone)",
  "raw-button": "hand-rolled <button> - compose BTN_* / toggleBtn / CHIP_TOGGLE / railIconBtn, or IconAction",
  "bare-rounded": "bare `rounded` - radius is a named step (rounded-md / -lg / -full)",
  "literal-page-header": "literal <header> border/pb - compose PAGE_HEADER",
  "raw-table": "raw <table> - no new tables until the kit table lands; an existing one composes app/_components/table/ parts + STICKY_HEAD",
};

/**
 * Paths (app-relative, POSIX) the style law does not reach:
 *   landing/, about/, market/   marketing, the fixed art direction
 *   features/gigs/              out of the kit effort; being rebuilt by its own session
 *   _components/kit/            the composition kit's own internals. EXEMPT ONLY WHILE
 *                               THEY ARE TOKEN-BASED: the kit is where the raw steps get
 *                               named once. A kit part that re-types a raw hue or a
 *                               below-floor size is a bug in the kit, not an exemption.
 */
const EXCLUDED_PREFIXES = ["landing/", "about/", "market/", "features/gigs/", "_components/kit/"];

export function isStyleScoped(rel: string): boolean {
  if (!rel.endsWith(".tsx") || rel.endsWith(".test.tsx")) return false;
  return !EXCLUDED_PREFIXES.some((p) => rel.startsWith(p));
}

const STATUS_HUES = "red|amber|green|blue|emerald|rose|yellow|orange|sky|indigo|violet|purple|pink|teal|cyan|lime";
const RE_RAW_TEXT_SIZE = /^text-(sm|base|lg|xl|[2-5]xl)(\/[\w.[\]-]+)?$/;
const RE_ARBITRARY_TEXT = /^text-\[(?:length:)?(?:[\d.]+(?:px|rem|em)|(?:calc|clamp|min|max)\()/;
const RE_ARBITRARY_PX_REM = /^text-\[(?:length:)?([\d.]+)(px|rem)\]/;
const RE_TEXT_XS = /^text-xs(\/[\w.[\]-]+)?$/;
const RE_STONE_TEXT = /^text-stone-\d+(\/\d+)?$/;
const RE_STATUS_HUE = new RegExp(`^(text|bg|border)-(${STATUS_HUES})-\\d+(\\/\\d+)?$`);
const RE_HEADER_RULE = /^(border(-[a-z]+)*(-\d+)?|pb-.+)$/;
const RE_SCREAMING = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

/** Exported names of recipes.ts — the camelCase recipe functions (toggleBtn, railIconBtn…). */
let recipeNames: Set<string> | null = null;
function sharedRecipeNames(): Set<string> {
  if (recipeNames) return recipeNames;
  const src = readFileSync(new URL("./recipes.ts", import.meta.url), "utf8");
  recipeNames = new Set([...src.matchAll(/export (?:const|function) (\w+)/g)].map((m) => m[1]));
  return recipeNames;
}

/** `dark:hover:!text-xs` → `text-xs`. Splits on `:` outside `[...]`. */
export function baseUtility(token: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "[") depth++;
    else if (c === "]") depth = Math.max(0, depth - 1);
    else if (c === ":" && depth === 0) start = i + 1;
  }
  return token.slice(start).replace(/^!/, "").replace(/!$/, "");
}

function tokenRules(u: string): StyleRule[] {
  const hits: StyleRule[] = [];
  if (RE_TEXT_XS.test(u)) hits.push("below-floor-text");
  else {
    const m = RE_ARBITRARY_PX_REM.exec(u);
    if (m && Number(m[1]) * (m[2] === "rem" ? 16 : 1) < 14) hits.push("below-floor-text");
  }
  if (RE_ARBITRARY_TEXT.test(u)) hits.push("arbitrary-text-size");
  if (RE_RAW_TEXT_SIZE.test(u)) hits.push("raw-text-size");
  if (RE_STONE_TEXT.test(u)) hits.push("raw-stone-text");
  if (RE_STATUS_HUE.test(u)) hits.push("raw-status-hue");
  if (u === "rounded") hits.push("bare-rounded");
  return hits;
}

function stringPiece(node: ts.Node): string | null {
  if (ts.isStringLiteral(node)) {
    const p = node.parent;
    if (p && (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p))) return null;
    return node.text;
  }
  if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
    return node.text;
  }
  return null;
}

function tokensOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean).map(baseUtility);
}

function jsxTag(node: ts.Node): { tag: string; attrs: ts.JsxAttributes } | null {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    return { tag: node.tagName.getText(), attrs: node.attributes };
  }
  return null;
}

function classNameInit(attrs: ts.JsxAttributes): ts.Node | null {
  for (const a of attrs.properties) {
    if (ts.isJsxAttribute(a) && a.name.getText() === "className" && a.initializer) return a.initializer;
  }
  return null;
}

/** Literal class tokens and identifier names inside a className initializer. */
function readClassName(init: ts.Node): { literal: string[]; idents: string[] } {
  const literal: string[] = [];
  const idents: string[] = [];
  const visit = (n: ts.Node): void => {
    const piece = stringPiece(n);
    if (piece != null) literal.push(...tokensOf(piece));
    else if (ts.isIdentifier(n)) idents.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(init);
  return { literal, idents };
}

export interface ButtonCensus {
  total: number;
  recipe: number;
  raw: number;
  delegated: number;
  unstyled: number;
}

export interface Measurement {
  counts: StyleCounts;
  buttons: ButtonCensus;
  /** 1-based line of each hit, for the hook's report. */
  lines: Partial<Record<StyleRule, number[]>>;
}

/** Measure one file. `rel` is app-relative POSIX (only `raw-table`'s carve-out reads it). */
export function measureSource(src: string, rel: string): Measurement {
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const counts: StyleCounts = {};
  const lines: Partial<Record<StyleRule, number[]>> = {};
  const buttons: ButtonCensus = { total: 0, recipe: 0, raw: 0, delegated: 0, unstyled: 0 };
  const hit = (rule: StyleRule, node: ts.Node): void => {
    counts[rule] = (counts[rule] ?? 0) + 1;
    (lines[rule] ??= []).push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
  };

  // Names imported from any recipes module count as recipe vocabulary too.
  const imported = new Set<string>();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && /recipes(\.ts)?$/i.test(st.moduleSpecifier.text)) {
      const b = st.importClause?.namedBindings;
      if (b && ts.isNamedImports(b)) for (const el of b.elements) imported.add(el.name.text);
    }
  }
  const shared = sharedRecipeNames();
  const isRecipe = (id: string): boolean => imported.has(id) || shared.has(id) || (id.length > 2 && RE_SCREAMING.test(id));

  const visit = (node: ts.Node): void => {
    const piece = stringPiece(node);
    if (piece != null) {
      for (const u of tokensOf(piece)) for (const r of tokenRules(u)) hit(r, node);
    }
    const el = jsxTag(node);
    if (el) {
      const init = el.tag === "button" || el.tag === "header" ? classNameInit(el.attrs) : null;
      const cls = init ? readClassName(init) : null;
      if (el.tag === "button") {
        buttons.total++;
        if (!cls) buttons.unstyled++;
        else if (cls.idents.some(isRecipe)) buttons.recipe++;
        else if (cls.literal.length === 0) buttons.delegated++;
        else {
          buttons.raw++;
          hit("raw-button", node);
        }
      } else if (el.tag === "header" && cls && !cls.idents.includes("PAGE_HEADER") && cls.literal.some((u) => RE_HEADER_RULE.test(u))) {
        hit("literal-page-header", node);
      } else if (el.tag === "table" && !rel.startsWith("_components/table/")) {
        hit("raw-table", node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { counts, buttons, lines };
}
