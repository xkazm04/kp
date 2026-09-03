/*
 * The recipe ratchet: hand-typed recipe literals can only get fewer.
 *
 * THE GAP THIS CLOSES: `recipes.ts` is the "write once, apply multiple times"
 * seam and `docs/design/README.md` says adoption is opportunistic — touch a
 * file, adopt the recipe. Nothing measured that. Sixteen waves later the tree
 * still re-typed the panel string on 107 lines, the meta label on 76, the
 * quiet chip on 10, and 62 amber advisory blocks sat beside the `NOTICE()`
 * recipe written to replace them. Every one of those is a surface that will
 * NOT follow when a recipe is restyled — which is the entire value of the
 * seam — and nothing in CI could tell "107, shrinking" from "107, on the way
 * to 150". `recipes-sizing.test.ts` next door guards one rule about recipe
 * USAGE; this guards the population that never became a usage at all.
 *
 * WHAT IT COUNTS, over `app/**\/*.tsx` (excluding `app/landing/**`, the fixed
 * art direction that is exempt from the design law generally): one hit per
 * LINE carrying the literal form of a recipe that already exists.
 *
 *   panel        the PANEL string re-typed (`rounded-lg border border-stone-200
 *                bg-white`). In Spark Dark these ride a globals.css fallback,
 *                so they look right and are still unmigrated.
 *   metaLabel    the META_LABEL string re-typed.
 *   chipQuiet    the CHIP_QUIET string re-typed.
 *   noticeAmber  an amber advisory block hand-rolled beside `NOTICE("amber")`.
 *   btnAffirm    a moss action button hand-rolled beside `BTN_AFFIRM`.
 *   rawDate      `toLocaleDateString()` / `new Intl.DateTimeFormat()` in a
 *                component, beside `useDateFormat()`. .tsx only ON PURPOSE:
 *                the replacement is a React hook, so a `.ts` module formatting
 *                a date for an email has no migration to make and counting it
 *                would be a ceiling nobody can lower.
 *
 * PER FILE, not one lump total, for the same reason ts-debt.json counts per
 * rule: a lump number lets a new literal in a new file hide under a deletion
 * somewhere else, and the per-file shape is also what makes the ratchet a
 * fix-as-you-touch backlog — the file you are already in tells you what it
 * owes.
 *
 * THE RULES:
 *   grew        more hits than the file's ceiling. BLOCKING — adopt the recipe
 *               instead of re-typing it.
 *   undeclared  a file with hits and no entry. BLOCKING — a NEW surface must
 *               compose the recipe from day one.
 *   slack       fewer hits than the ceiling: a NOTE that prints `tighten`.
 *               Making every burnt-down literal a red build taxes the fix
 *               rather than the debt.
 *   burnt-down  zero hits against a non-zero ceiling. Also a note; `--tighten`
 *               drops the entry entirely, which LOCKS the win — the file is
 *               then `undeclared` and the next literal to arrive is red.
 *
 * Never raise a number to go green. Lowering happens by adopting the recipe
 * and then:
 *
 *   node --experimental-transform-types app/_components/ui/recipes-literals.test.ts --tighten
 *
 * which rewrites `recipe-debt.json` from the tree (it refuses if the walk
 * found no files at all, so it can never zero the list against a tree it
 * never opened). The check itself is just `npm run test:unit` — no script
 * alias, the runner already picks this file up.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "..", "..");
const DEBT_FILE = path.join(HERE, "recipe-debt.json");

/** Literal forms of recipes that already exist. Line-matched. */
const RULES = {
  panel: /rounded-lg border border-stone-200 bg-white/,
  metaLabel: /text-meta uppercase text-steel/,
  chipQuiet: /rounded-full bg-stone-100 px-2 py-0\.5/,
  noticeAmber: /border-amber-\d+ bg-amber-50/,
  btnAffirm: /bg-moss(?![\w-])(?=.*text-white)/,
  rawDate: /\.toLocaleDateString\(|new Intl\.DateTimeFormat\(/,
} as const;

type RuleName = keyof typeof RULES;
const RULE_NAMES = Object.keys(RULES) as RuleName[];

type Counts = Partial<Record<RuleName, number>>;
interface DebtFile {
  $comment?: string[];
  ceilings: Record<string, Counts>;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const child = path.join(dir, entry.name);
      // app/landing/** only — the fixed art direction, exempt from the design law.
      if (entry.name === "node_modules" || entry.name.startsWith(".") || child === path.join(APP_DIR, "landing")) continue;
      walk(child, out);
    } else if (entry.name.endsWith(".tsx")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** Per-file hit counts for every rule, keyed by app-relative POSIX path. */
export function scanTree(): { counts: Record<string, Counts>; fileCount: number } {
  const files = walk(APP_DIR);
  const counts: Record<string, Counts> = {};
  for (const file of files) {
    const rel = path.relative(APP_DIR, file).split(path.sep).join("/");
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    const per: Counts = {};
    for (const name of RULE_NAMES) {
      const n = lines.filter((l) => RULES[name].test(l)).length;
      if (n > 0) per[name] = n;
    }
    if (Object.keys(per).length > 0) counts[rel] = per;
  }
  return { counts, fileCount: files.length };
}

function readDebt(): DebtFile {
  return JSON.parse(readFileSync(DEBT_FILE, "utf8")) as DebtFile;
}

interface Finding {
  blocking: boolean;
  message: string;
}

export function evaluate(): { findings: Finding[]; notes: Finding[]; totals: Record<string, number> } {
  const { counts, fileCount } = scanTree();
  if (fileCount === 0) {
    throw new Error("recipe ratchet: the walk found no .tsx under app/ — refusing to report on a tree it never opened");
  }
  const debt = readDebt();
  const findings: Finding[] = [];
  const notes: Finding[] = [];
  const totals: Record<string, number> = {};

  for (const [file, per] of Object.entries(counts)) {
    const ceiling = debt.ceilings[file];
    for (const [rule, n] of Object.entries(per) as [RuleName, number][]) {
      totals[rule] = (totals[rule] ?? 0) + n;
      const max = ceiling?.[rule];
      if (max == null) {
        findings.push({
          blocking: true,
          message: `undeclared  ${file} ${rule}=${n} — compose the recipe instead of re-typing it (see recipes.ts)`,
        });
      } else if (n > max) {
        findings.push({
          blocking: true,
          message: `grew        ${file} ${rule}=${n} > ${max} — adopt the recipe; the ceiling is never raised`,
        });
      } else if (n < max) {
        notes.push({ blocking: false, message: `tighten     ${file} ${rule}=${n} < ${max}` });
      }
    }
  }
  for (const [file, per] of Object.entries(debt.ceilings)) {
    for (const rule of Object.keys(per) as RuleName[]) {
      if (counts[file]?.[rule] == null) {
        notes.push({ blocking: false, message: `tighten     ${file} ${rule}=0 (burnt down) — drop the entry` });
      }
    }
  }
  return { findings, notes, totals };
}

function tighten(): void {
  const { counts, fileCount } = scanTree();
  if (fileCount === 0) throw new Error("recipe ratchet: refusing to --tighten against a tree with no .tsx files");
  const debt = readDebt();
  const next: Record<string, Counts> = {};
  for (const file of Object.keys(counts).sort()) {
    const per: Counts = {};
    for (const rule of RULE_NAMES) {
      const n = counts[file][rule];
      if (n != null) per[rule] = n;
    }
    next[file] = per;
  }
  debt.ceilings = next;
  writeFileSync(DEBT_FILE, `${JSON.stringify(debt, null, 2)}\n`, "utf8");
  const totals = RULE_NAMES.map((r) => `${r}=${Object.values(counts).reduce((a, c) => a + (c[r] ?? 0), 0)}`);
  console.log(`recipe ratchet tightened: ${Object.keys(next).length} files · ${totals.join(" ")}`);
}

if (process.argv.includes("--tighten")) {
  tighten();
} else {
  test("recipe literals ratchet — a hand-typed recipe count can only fall", () => {
    const { findings, notes, totals } = evaluate();
    if (notes.length > 0) {
      console.log(`recipe ratchet: ${notes.length} entr${notes.length === 1 ? "y" : "ies"} with slack — run with --tighten`);
      for (const n of notes.slice(0, 20)) console.log(`  ${n.message}`);
    }
    console.log(`recipe ratchet totals: ${RULE_NAMES.map((r) => `${r}=${totals[r] ?? 0}`).join(" ")}`);
    assert.deepEqual(
      findings.map((f) => f.message),
      [],
      `hand-typed recipe literals grew — adopt the recipe from app/_components/ui/recipes.ts:\n${findings
        .map((f) => f.message)
        .join("\n")}`
    );
  });
}
