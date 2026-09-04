/*
 * Every table header cell declares what it heads.
 *
 * `<th>` without `scope` is a header that assistive tech has to GUESS the
 * direction of. Browsers do guess, and the guess is only right for the simple
 * single-header-row case — which is not the shape of the studio's comparison
 * grids (a frozen first column of row headers), its matrix (headers on both
 * axes), or any table whose header row carries a filter control. A screen
 * reader that guesses wrong reads every cell against the wrong label, which is
 * worse than reading none: the numbers are announced, attached to the wrong
 * candidate.
 *
 * `ColumnHead` (app/_components/table/ColumnHead.tsx) has always rendered the
 * `<th>` itself precisely so `scope` and `aria-sort` cannot be omitted — but it
 * only reaches the tables that adopted it. At the time this guard was written
 * 74 of the tree's 124 header cells declared nothing, including six surfaces
 * that already imported the shared filter and then hand-rolled their headers
 * around it.
 *
 * WHY A REPO-WIDE GATE AND NOT A RATCHET: unlike a recipe literal, this has no
 * legitimate residual population. `scope` is one attribute, its value is
 * determined by where the cell sits (`col` in a `<thead>` row, `row` for a
 * cell that heads its own row), and there is no table shape in this product
 * that wants neither. A holdout list would only record which files nobody has
 * opened yet.
 *
 * Source-level, like the other a11y guards in this tree (`filter-a11y.test.ts`,
 * `Select.test.ts`): there is no JSX runner in the unit suite, and the rule is
 * a property of the markup rather than of a render.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(child, out);
    } else if (entry.name.endsWith(".tsx")) {
      out.push(child);
    }
  }
  return out;
}

/**
 * Blank out comments so prose mentioning `<th>` is not read as markup — the
 * shared table components discuss their own `<th>` at length. Replaced with
 * spaces rather than removed, so line numbers survive for the failure message.
 */
function blankComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\r\n]/g, " ");
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:"'`\\])\/\/[^\r\n]*/g, (m, lead: string) => lead + blank(m.slice(lead.length)));
}

/**
 * Every `<th …>` opening tag, with its line number. Scans to the tag's own `>`
 * while tracking JSX-expression brace depth and quotes, so an attribute holding
 * an arrow function or a comparison does not end the tag early.
 */
export function headerTags(src: string): { line: number; tag: string }[] {
  const text = blankComments(src);
  const found: { line: number; tag: string }[] = [];
  const open = /<th(?=[\s/>])/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(text)) !== null) {
    let depth = 0;
    let quote: string | null = null;
    let end = -1;
    for (let i = m.index; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        end = i;
        break;
      }
    }
    if (end === -1) continue;
    found.push({ line: text.slice(0, m.index).split("\n").length, tag: text.slice(m.index, end + 1) });
    open.lastIndex = end;
  }
  return found;
}

test("every <th> in app/ declares a scope", () => {
  const files = walk(HERE);
  assert.ok(files.length > 0, "the walk found no .tsx under app/ — refusing to report on a tree it never opened");
  const offenders: string[] = [];
  let total = 0;
  for (const file of files) {
    const rel = path.relative(HERE, file).split(path.sep).join("/");
    for (const { line, tag } of headerTags(readFileSync(file, "utf8"))) {
      total++;
      // `scope={…}` is fine: a cell whose direction genuinely depends on props.
      if (!/\bscope=/.test(tag)) offenders.push(`app/${rel}:${line}`);
    }
  }
  assert.ok(total > 50, `expected the tree to hold header cells, found ${total} — the scanner is broken`);
  assert.deepEqual(
    offenders,
    [],
    `header cells with no scope (use ColumnHead, or add scope="col" / scope="row"):\n${offenders.join("\n")}`
  );
});
