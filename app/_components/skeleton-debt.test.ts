/*
 * The skeleton ratchet: a `<Skeleton` call site can only get fewer.
 *
 * THE GAP THIS CLOSES: loading choreography law 4 is "No skeletons."
 * `LoadingGap` is the named quiet box. `Skeleton` remains a shared primitive
 * with a live population, so new code still reaches for a pulse bar and nothing
 * in the unit gate stops a fifteenth surface from doing it. This is a freeze,
 * not a migration — existing files keep their ceiling until someone adopts
 * LoadingGap and `--tighten`s.
 *
 * WHAT IT COUNTS, over `app/**\/*.tsx` (`app/landing/**` excluded): one hit per
 * LINE that carries `<Skeleton`. Comment-only lines and `Skeleton.tsx` itself
 * (the definition) are skipped.
 *
 * PER FILE, same as recipe-debt.json: grew and undeclared are blocking; slack
 * and burnt-down print `tighten`. Never raise a number to go green. Adopt
 * `<LoadingGap>`, then:
 *
 *   node --experimental-transform-types app/_components/skeleton-debt.test.ts --tighten
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "..");
const DEBT_FILE = path.join(HERE, "skeleton-debt.json");

const RULE = "skeleton";

interface DebtFile {
  $comment?: string[];
  ceilings: Record<string, { skeleton: number }>;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const child = path.join(dir, entry.name);
      if (entry.name === "node_modules" || entry.name.startsWith(".") || child === path.join(APP_DIR, "landing")) continue;
      walk(child, out);
    } else if (entry.name.endsWith(".tsx")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

/** A JSX Skeleton call: the form the choreography law forbids on new surfaces. */
export function isSkeletonLine(line: string): boolean {
  if (isCommentLine(line)) return false;
  return line.includes("<Skeleton");
}

/** Per-file hit counts, keyed by app-relative POSIX path. */
export function scanTree(): { counts: Record<string, number>; fileCount: number } {
  const files = walk(APP_DIR);
  const counts: Record<string, number> = {};
  for (const file of files) {
    if (path.basename(file) === "Skeleton.tsx") continue;
    const rel = path.relative(APP_DIR, file).split(path.sep).join("/");
    const n = readFileSync(file, "utf8").split(/\r?\n/).filter(isSkeletonLine).length;
    if (n > 0) counts[rel] = n;
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

export function evaluate(): { findings: Finding[]; notes: Finding[]; total: number } {
  const { counts, fileCount } = scanTree();
  if (fileCount === 0) {
    throw new Error("skeleton ratchet: the walk found no .tsx under app/ — refusing to report on a tree it never opened");
  }
  const debt = readDebt();
  const findings: Finding[] = [];
  const notes: Finding[] = [];
  let total = 0;

  for (const [file, n] of Object.entries(counts)) {
    total += n;
    const max = debt.ceilings[file]?.[RULE];
    if (max == null) {
      findings.push({
        blocking: true,
        message: `undeclared  ${file} ${RULE}=${n} — use <LoadingGap> for a whole view/panel body (see loading-choreography.md)`,
      });
    } else if (n > max) {
      findings.push({
        blocking: true,
        message: `grew        ${file} ${RULE}=${n} > ${max} — adopt LoadingGap; the ceiling is never raised`,
      });
    } else if (n < max) {
      notes.push({ blocking: false, message: `tighten     ${file} ${RULE}=${n} < ${max}` });
    }
  }
  for (const file of Object.keys(debt.ceilings)) {
    if (counts[file] == null) {
      notes.push({ blocking: false, message: `tighten     ${file} ${RULE}=0 (burnt down) — drop the entry` });
    }
  }
  return { findings, notes, total };
}

function tighten(): void {
  const { counts, fileCount } = scanTree();
  if (fileCount === 0) throw new Error("skeleton ratchet: refusing to --tighten against a tree with no .tsx files");
  const debt = readDebt();
  const next: Record<string, { skeleton: number }> = {};
  for (const file of Object.keys(counts).sort()) {
    next[file] = { [RULE]: counts[file] };
  }
  debt.ceilings = next;
  writeFileSync(DEBT_FILE, `${JSON.stringify(debt, null, 2)}\n`, "utf8");
  console.log(`skeleton ratchet tightened: ${Object.keys(next).length} files · ${RULE}=${Object.values(counts).reduce((a, n) => a + n, 0)}`);
}

if (process.argv.includes("--tighten")) {
  tighten();
} else {
  test("skeleton ratchet — a <Skeleton call site can only fall", () => {
    const { findings, notes, total } = evaluate();
    if (notes.length > 0) {
      console.log(`skeleton ratchet: ${notes.length} entr${notes.length === 1 ? "y" : "ies"} with slack — run with --tighten`);
      for (const n of notes.slice(0, 20)) console.log(`  ${n.message}`);
    }
    console.log(`skeleton ratchet total: ${RULE}=${total}`);
    assert.deepEqual(
      findings.map((f) => f.message),
      [],
      `Skeleton call sites grew — use LoadingGap:\n${findings.map((f) => f.message).join("\n")}`
    );
  });

  test("a new undeclared file with <Skeleton fails the unit gate", () => {
    const { counts } = scanTree();
    assert.equal(counts["_components/Skeleton.tsx"], undefined, "the definition is not a call site");
    assert.ok(Object.keys(counts).length > 0, "the walk must see the existing population or the freeze is vacuous");
    const debt = readDebt();
    for (const file of Object.keys(counts)) {
      assert.ok(debt.ceilings[file], `existing call site ${file} must be declared so a NEW file is the undeclared case`);
    }
  });
}
