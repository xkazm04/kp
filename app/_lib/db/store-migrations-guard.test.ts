// Source guard: no NEW catch-all around an additive-column migration.
//
// The shape it hunts is `try { d.exec(`ALTER TABLE t ADD COLUMN c`) } catch { /* column
// already exists */ }` — a catch that also swallows SQLITE_READONLY / FULL / IOERR / CORRUPT
// (and BUSY once busy_timeout expires) and lets the store memoize a connection whose table
// is missing the column. The replacement is addColumns() (app/_lib/db/add-columns.ts): probe,
// ALTER only what is missing, re-check a duplicate-column race, throw everything else.
//
// CEILING is a ratchet, not an allowance: it lists the files that still carry the old shape
// (each held by another card's write set when the migrator landed) with their CURRENT count.
// The real tree must match it EXACTLY — a new site anywhere fails, and converting one of
// these files fails too until its row is lowered or deleted here, so the map only goes down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const CEILING: Record<string, number> = {
  "app/_lib/ats/connections-store.ts": 1,
  "app/_lib/ats-config-store.ts": 1,
  "app/_lib/comms-relay-store.ts": 1,
  "app/_lib/db/agents.ts": 1,
  "app/_lib/db/devcase.ts": 1,
  "app/_lib/db/intakes.ts": 1,
  "app/_lib/db/skill-profiles.ts": 1,
  "app/_lib/edge-config.ts": 1,
  "app/_lib/interview-prep.ts": 1,
  "app/_lib/rediscovery-alert-store.ts": 2,
};

const ALTER_EXEC = /\.exec\(\s*([`'"])\s*ALTER\s+TABLE\s+[\w${}]+\s+ADD\s+COLUMN/gi;
// The catch that closes the try around the ALTER: the exec statement ends (`);`, an optional
// line comment) and the very next token is `} catch`. An unrelated try/catch further down is
// not the ALTER's catch and is not counted.
const CLOSING_CATCH = /^\s*;?[ \t]*(?:\/\/[^\n]*)?\s*\}\s*catch\s*(?:\([^)]*\))?\s*\{/;

/** The body of the block whose `{` sits at `open`, braces balanced. */
function blockAt(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

/** Count ADD COLUMN execs whose enclosing try closes on a catch that never throws. */
function swallowingAlterSites(src: string): number {
  let count = 0;
  for (const m of src.matchAll(ALTER_EXEC)) {
    const start = m.index ?? 0;
    // The end of the exec(...) call: the first `)` after the SQL literal closes.
    const quote = m[1] ?? "`";
    const literalEnd = src.indexOf(quote, start + m[0].length);
    if (literalEnd === -1) continue;
    const callEnd = src.indexOf(")", literalEnd);
    if (callEnd === -1) continue;
    const c = CLOSING_CATCH.exec(src.slice(callEnd + 1));
    if (!c) continue;
    const open = callEnd + 1 + c.index + c[0].length - 1;
    if (!/\bthrow\b/.test(blockAt(src, open))) count++;
  }
  return count;
}

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

test("fixture: the swallow-all shape is flagged", () => {
  const src = [
    "function db() {",
    "  try {",
    "    d.exec(`ALTER TABLE t ADD COLUMN c TEXT`);",
    "  } catch {",
    "    /* column already exists */",
    "  }",
    "}",
  ].join("\n");
  assert.equal(swallowingAlterSites(src), 1);
  const loop = 'for (const col of cols) {\n  try {\n    d.exec(`ALTER TABLE t ADD COLUMN ${col}`);\n  } catch (e) {\n    console.warn(e);\n  }\n}';
  assert.equal(swallowingAlterSites(loop), 1, "a catch that only logs still swallows");
});

test("fixture: the probe shape and a catch that re-throws are not flagged", () => {
  const probe = [
    "const cols = d.prepare(`PRAGMA table_info(t)`).all();",
    "if (!cols.some((c) => c.name === 'c')) {",
    "  d.exec(`ALTER TABLE t ADD COLUMN c TEXT`);",
    "}",
    "try { other(); } catch { /* unrelated: not the ALTER's own catch */ }",
  ].join("\n");
  assert.equal(swallowingAlterSites(probe), 0);
  const rethrow = "try {\n  d.exec(`ALTER TABLE t ADD COLUMN c TEXT`);\n} catch (e) {\n  if (!benign(e)) throw e;\n}";
  assert.equal(swallowingAlterSites(rethrow), 0);
  assert.equal(swallowingAlterSites("addColumns(d, 't', ['c TEXT']);"), 0);
});

test("the real tree's swallow-all ALTER sites match the ceiling map exactly", () => {
  const root = process.cwd();
  const found: Record<string, number> = {};
  for (const file of walk(path.join(root, "app"), [])) {
    const n = swallowingAlterSites(readFileSync(file, "utf8"));
    if (n > 0) found[path.relative(root, file).split(path.sep).join("/")] = n;
  }
  assert.deepEqual(
    found,
    CEILING,
    "a swallow-all `catch` around an ADD COLUMN was added (use addColumns from app/_lib/db/add-columns.ts), " +
      "or a listed file was converted (lower or delete its row in CEILING)"
  );
});
