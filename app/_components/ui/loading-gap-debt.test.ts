/*
 * The loading-gap ratchet: a silent block-level `reveal-quiet` + `aria-hidden`
 * box can only get fewer.
 *
 * THE GAP THIS CLOSES: `LoadingGap` is the named `role=status` stand-in for a
 * whole view or panel body. Design README still described ~80 block-level gaps
 * as a prose backlog, so a new tab could add the silent box and nothing in CI
 * would notice. Inline shimmers (`inline-block h-4 w-24 …`) stay `aria-hidden`
 * on purpose — the row around them is already announced.
 *
 * WHAT IT COUNTS, over `app/**\/*.tsx` (`app/landing/**` excluded): one hit per
 * LINE that carries `reveal-quiet` AND `aria-hidden` and is not the documented
 * inline exception (`inline-block`). Comment-only lines and `LoadingGap.tsx`
 * itself (which documents the old form) are skipped.
 *
 * PER FILE, same as recipe-debt.json: grew and undeclared are blocking; slack
 * and burnt-down print `tighten`. Never raise a number to go green. Adopt
 * `<LoadingGap>`, then:
 *
 *   node --experimental-transform-types app/_components/ui/loading-gap-debt.test.ts --tighten
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "..", "..");
const DEBT_FILE = path.join(HERE, "loading-gap-debt.json");

const RULE = "blockGap";

interface DebtFile {
  $comment?: string[];
  ceilings: Record<string, { blockGap: number }>;
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

/** A silent block-level gap: the form LoadingGap replaces. */
export function isBlockGapLine(line: string): boolean {
  if (isCommentLine(line)) return false;
  if (!line.includes("reveal-quiet") || !line.includes("aria-hidden")) return false;
  // Documented exception: inline shimmer for one value in an already-rendered row.
  if (/\binline-block\b/.test(line)) return false;
  return true;
}

/** Per-file hit counts, keyed by app-relative POSIX path. */
export function scanTree(): { counts: Record<string, number>; fileCount: number } {
  const files = walk(APP_DIR);
  const counts: Record<string, number> = {};
  for (const file of files) {
    if (path.basename(file) === "LoadingGap.tsx") continue;
    const rel = path.relative(APP_DIR, file).split(path.sep).join("/");
    const n = readFileSync(file, "utf8").split(/\r?\n/).filter(isBlockGapLine).length;
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
    throw new Error("loading-gap ratchet: the walk found no .tsx under app/ — refusing to report on a tree it never opened");
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
        message: `undeclared  ${file} ${RULE}=${n} — use <LoadingGap> for a whole view/panel body (see LoadingGap.tsx)`,
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
  if (fileCount === 0) throw new Error("loading-gap ratchet: refusing to --tighten against a tree with no .tsx files");
  const debt = readDebt();
  const next: Record<string, { blockGap: number }> = {};
  for (const file of Object.keys(counts).sort()) {
    next[file] = { [RULE]: counts[file] };
  }
  debt.ceilings = next;
  writeFileSync(DEBT_FILE, `${JSON.stringify(debt, null, 2)}\n`, "utf8");
  console.log(`loading-gap ratchet tightened: ${Object.keys(next).length} files · ${RULE}=${Object.values(counts).reduce((a, n) => a + n, 0)}`);
}

if (process.argv.includes("--tighten")) {
  tighten();
} else {
  test("loading-gap ratchet — a silent block-level aria-hidden box can only fall", () => {
    const { findings, notes, total } = evaluate();
    if (notes.length > 0) {
      console.log(`loading-gap ratchet: ${notes.length} entr${notes.length === 1 ? "y" : "ies"} with slack — run with --tighten`);
      for (const n of notes.slice(0, 20)) console.log(`  ${n.message}`);
    }
    console.log(`loading-gap ratchet total: ${RULE}=${total}`);
    assert.deepEqual(
      findings.map((f) => f.message),
      [],
      `silent block-level reveal-quiet aria-hidden gaps grew — use LoadingGap:\n${findings.map((f) => f.message).join("\n")}`
    );
  });

  test("inline shimmers stay outside the ceiling; known panel gaps stay inside", () => {
    const { counts } = scanTree();
    assert.equal(counts["features/tools/profile/ProfileRoster.tsx"], undefined, "inline-block h-4 w-24 shimmers are the documented exception");
    assert.equal(counts["_components/ui/LoadingGap.tsx"], undefined);
    assert.ok((counts["features/library/jobs/JobsTabResults.tsx"] ?? 0) >= 1, "JobsTabResults is a declared panel-body gap");
    assert.ok((counts["features/settings/models/ModelsTab.tsx"] ?? 0) >= 1, "ModelsTab's Gap is the choreography reference and is still silent");
    assert.ok((counts["features/settings/workspace/WorkspaceTab.tsx"] ?? 0) >= 1);
  });
}
