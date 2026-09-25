/*
 * The style ratchet: a raw style step can only get rarer.
 *
 * THE GAP THIS CLOSES: the type scale, the 14px floor, the brand tokens and the
 * recipes are all written down (docs/design/README.md) and none of them was
 * measured. `design:check` holds brand lockstep and shade parity; eslint bans
 * hex. Nothing counted `text-xs` under the floor, a raw `text-sm` beside
 * `text-meta`, a `text-amber-700` beside the brand tokens, a bare `rounded`, a
 * hand-rolled `<button>` beside `BTN_*`, a re-typed page header beside
 * `PAGE_HEADER` or a raw `<table>` beside `app/_components/table/`. While the
 * composition kit is being chosen and applied, this freezes the tree so the
 * debt it will retire cannot grow underneath it.
 *
 * WHAT IT COUNTS, over `app/**\/*.tsx` minus tests, `app/landing/**`,
 * `app/about/**`, `app/market/**`, `app/features/gigs/**` and
 * `app/_components/kit/**` (the kit's internals — exempt only while they are
 * token-based; see style-debt-rules.ts). The nine rules and their matchers live
 * in `style-debt-rules.ts`, shared with the edit-time hook
 * `scripts/style/lint-edited.mjs`. Counts are per occurrence, JSX-aware.
 *
 * PER FILE, PER RULE, in `style-debt.json` — the recipe-debt.json idiom:
 *   grew        more hits than the file's ceiling for that rule. BLOCKING.
 *   undeclared  a file with hits and no ceiling for that rule. BLOCKING — a new
 *               surface composes tokens and recipes from day one.
 *   dead-rule   a rule that matches NOTHING anywhere. BLOCKING — a matcher that
 *               finds nothing is assumed broken, not the tree clean.
 *   slack       fewer hits than the ceiling: a NOTE that prints `tighten`, as in
 *               every other ratchet here (scripts/lint/ratchet.mjs explains why:
 *               a red build on every fix taxes the fix, not the debt).
 *   burnt-down  zero hits against a ceiling. Also a note; `--tighten` drops the
 *               entry, which LOCKS the win.
 *
 * Never raise a number to go green (ADR 0007). Fix, then:
 *
 *   node --experimental-transform-types app/_components/ui/style-debt.test.ts --tighten
 *
 * The check itself is `npm run test:unit`; the runner already globs this file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isStyleScoped, measureSource, STYLE_REMEDY, STYLE_RULES, type StyleCounts, type StyleRule } from "./style-debt-rules.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "..", "..");
const DEBT_FILE = path.join(HERE, "style-debt.json");

interface DebtFile {
  $comment?: string[];
  ceilings: Record<string, StyleCounts>;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.name.endsWith(".tsx")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

export function scanTree(): { counts: Record<string, StyleCounts>; fileCount: number } {
  const counts: Record<string, StyleCounts> = {};
  let fileCount = 0;
  for (const file of walk(APP_DIR)) {
    const rel = path.relative(APP_DIR, file).split(path.sep).join("/");
    if (!isStyleScoped(rel)) continue;
    fileCount++;
    const m = measureSource(readFileSync(file, "utf8"), rel);
    if (Object.keys(m.counts).length > 0) counts[rel] = m.counts;
  }
  return { counts, fileCount };
}

function readDebt(): DebtFile {
  return JSON.parse(readFileSync(DEBT_FILE, "utf8")) as DebtFile;
}

export function evaluate(): { findings: string[]; notes: string[]; totals: Record<string, number> } {
  const { counts, fileCount } = scanTree();
  if (fileCount === 0) {
    throw new Error("style ratchet: the walk found no in-scope .tsx under app/ — refusing to report on a tree it never opened");
  }
  const debt = readDebt();
  const findings: string[] = [];
  const notes: string[] = [];
  const totals: Record<string, number> = {};

  for (const [file, per] of Object.entries(counts)) {
    for (const [rule, n] of Object.entries(per) as [StyleRule, number][]) {
      totals[rule] = (totals[rule] ?? 0) + n;
      const max = debt.ceilings[file]?.[rule];
      if (max == null) findings.push(`undeclared  ${file} ${rule}=${n} — ${STYLE_REMEDY[rule]}`);
      else if (n > max) findings.push(`grew        ${file} ${rule}=${n} > ${max} — ${STYLE_REMEDY[rule]}; the ceiling is never raised`);
      else if (n < max) notes.push(`tighten     ${file} ${rule}=${n} < ${max}`);
    }
  }
  for (const [file, per] of Object.entries(debt.ceilings)) {
    for (const rule of Object.keys(per) as StyleRule[]) {
      if (counts[file]?.[rule] == null) notes.push(`tighten     ${file} ${rule}=0 (burnt down) — drop the entry`);
    }
  }
  for (const rule of STYLE_RULES) {
    if (!totals[rule]) findings.push(`dead-rule   ${rule} matched nothing in ${fileCount} files — the matcher is broken, not the tree clean`);
  }
  return { findings, notes, totals };
}

function tighten(): void {
  const { counts, fileCount } = scanTree();
  if (fileCount === 0) throw new Error("style ratchet: refusing to --tighten against a tree with no in-scope .tsx files");
  const debt = readDebt();
  const next: Record<string, StyleCounts> = {};
  for (const file of Object.keys(counts).sort()) {
    const per: StyleCounts = {};
    for (const rule of STYLE_RULES) {
      const n = counts[file][rule];
      if (n != null) per[rule] = n;
    }
    next[file] = per;
  }
  debt.ceilings = next;
  writeFileSync(DEBT_FILE, `${JSON.stringify(debt, null, 2)}\n`, "utf8");
  const totals = STYLE_RULES.map((r) => `${r}=${Object.values(counts).reduce((a, c) => a + (c[r] ?? 0), 0)}`);
  console.log(`style ratchet tightened: ${Object.keys(next).length} files · ${totals.join(" ")}`);
}

if (process.argv.includes("--tighten")) {
  tighten();
} else {
  test("style ratchet — a raw style step can only get rarer", () => {
    const { findings, notes, totals } = evaluate();
    if (notes.length > 0) {
      console.log(`style ratchet: ${notes.length} entr${notes.length === 1 ? "y" : "ies"} with slack — run with --tighten`);
      for (const n of notes.slice(0, 20)) console.log(`  ${n}`);
    }
    console.log(`style ratchet totals: ${STYLE_RULES.map((r) => `${r}=${totals[r] ?? 0}`).join(" ")}`);
    assert.deepEqual(findings, [], `raw style steps grew — see .claude/rules/ui.md:\n${findings.join("\n")}`);
  });

  test("the matchers see what they claim to, and nothing in comments or prose", () => {
    const src = [
      `import { BTN_PRIMARY, PAGE_HEADER } from "@/app/_components/ui/recipes";`,
      `// text-xs rounded <table> in a comment is not a class`,
      `export function X({ on }: { on: boolean }) {`,
      `  return (<div className="dark:text-xs text-[11px] text-[1rem] text-sm/6 text-stone-500 hover:bg-red-50 rounded rounded-md">`,
      `    <p>Don't text-xs me</p>`,
      `    <header className="border-b pb-4" /><header className={PAGE_HEADER} />`,
      `    <button className={\`\${BTN_PRIMARY} h-9 px-4 text-meta\`} /><button className={on ? "px-2" : "px-3"} />`,
      `    <button className={className} /><button type="button" /><table />`,
      `  </div>);`,
      `}`,
    ].join("\n");
    const { counts, buttons } = measureSource(src, "features/x/X.tsx");
    assert.deepEqual(counts, {
      "below-floor-text": 2,
      "arbitrary-text-size": 2,
      "raw-text-size": 1,
      "raw-stone-text": 1,
      "raw-status-hue": 1,
      "bare-rounded": 1,
      "literal-page-header": 1,
      "raw-button": 1,
      "raw-table": 1,
    });
    assert.deepEqual(buttons, { total: 4, recipe: 1, raw: 1, delegated: 1, unstyled: 1 });
    assert.equal(measureSource("<table />", "_components/table/DataTable.tsx").counts["raw-table"], undefined);
  });
}
