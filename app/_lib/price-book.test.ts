// Pins docs/architecture/price-book.md to the TypeScript rate tables, in both directions:
// every key and value the code applies appears in the book with the same number, and no
// book row names a code home that no longer has that key. MTOK_PRICES has the same pin on
// the Python side (pipeline/jobfit/tests/test_price_book.py).
//
// Source files are read as TEXT (the approach of github/usage.test.ts): importing the
// tables would pull in the voice and env plumbing for no gain.
//
// Runner: node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");

const BOOK = read("../../docs/architecture/price-book.md");

/** The TypeScript code homes: `file:TABLE.key` (a table entry) or `file:CONSTANT`. */
const TS_HOME = /`((?:app\/_lib\/[\w./-]+)):([A-Z_]+)(?:\.(\w+))?`/;

interface BookRow {
  home: string;
  file: string;
  symbol: string;
  key: string | null;
  rate: string;
}

function bookRows(): BookRow[] {
  const rows: BookRow[] = [];
  for (const line of BOOK.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== 7) continue;
    const m = TS_HOME.exec(cells[6]);
    if (!m) continue;
    rows.push({ home: cells[6], file: m[1], symbol: m[2], key: m[3] ?? null, rate: cells[2] });
  }
  return rows;
}

/** `export const NAME ... = { key: 1.5, ... };` as a key to number map. */
function tableOf(src: string, name: string): Record<string, number> {
  const body = new RegExp(String.raw`export const ${name}\b[^=]*=\s*\{([^}]*)\}`).exec(src)?.[1];
  assert.ok(body, `${name} must be an object literal in the source`);
  const out: Record<string, number> = {};
  for (const m of body.matchAll(/^\s*(\w+):\s*([\d.]+),/gm)) out[m[1]] = Number(m[2]);
  assert.ok(Object.keys(out).length > 0, `${name} parsed to no entries`);
  return out;
}

const TABLES = [
  { file: "app/_lib/stt-prices.ts", name: "STT_HOUR_PRICES" },
  { file: "app/_lib/tts-prices.ts", name: "TTS_KCHAR_PRICES" },
  { file: "app/_lib/voice/minute-prices.ts", name: "VOICE_MINUTE_PRICES" },
] as const;

const src = (file: string) => read(`../../${file}`);

for (const { file, name } of TABLES) {
  test(`${name}: every key and value appears in the price book`, () => {
    const table = tableOf(src(file), name);
    const rows = bookRows().filter((r) => r.file === file && r.symbol === name);
    for (const [key, value] of Object.entries(table)) {
      const row = rows.find((r) => r.key === key);
      assert.ok(row, `price-book.md has no row with code home ${file}:${name}.${key}`);
      assert.equal(Number(row.rate), value, `${name}.${key} drifted from the book (${row.rate} vs ${value})`);
    }
  });

  test(`${name}: no book row names a key the code no longer has`, () => {
    const table = tableOf(src(file), name);
    for (const row of bookRows().filter((r) => r.file === file && r.symbol === name)) {
      assert.ok(row.key !== null && row.key in table, `price-book.md names ${row.home}, which is not in ${name}`);
    }
  });
}

test("the Gemini pair in github/usage.ts appears in the book with the same numbers", () => {
  const usage = src("app/_lib/github/usage.ts");
  const rows = bookRows().filter((r) => r.file === "app/_lib/github/usage.ts");
  for (const symbol of ["GEMINI_MTOK_PRICE_IN_USD", "GEMINI_MTOK_PRICE_OUT_USD"]) {
    const value = Number(new RegExp(String.raw`const ${symbol} = ([\d.]+);`).exec(usage)?.[1]);
    assert.ok(Number.isFinite(value), `usage.ts must define ${symbol}`);
    const row = rows.find((r) => r.symbol === symbol);
    assert.ok(row, `price-book.md has no row with code home usage.ts:${symbol}`);
    assert.equal(Number(row.rate), value, `${symbol} drifted from the book`);
  }
  for (const row of rows) {
    assert.ok(usage.includes(`const ${row.symbol} =`), `price-book.md names ${row.home}, which usage.ts no longer defines`);
  }
});

test("the book has the four sections and every basis is from the closed vocabulary", () => {
  for (const h of ["## 1. Meters", "## 2. Records", "## 3. Features", "## 4. Unknowns"]) {
    assert.ok(BOOK.includes(h), `price-book.md lost its ${h} section`);
  }
  const allowed = new Set(["list price", "estimate", "known zero", "provider-reported", "unknown"]);
  for (const line of BOOK.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== 7 || cells[0] === "meter" || /^-+$/.test(cells[0])) continue;
    assert.ok(allowed.has(cells[3]), `basis "${cells[3]}" of "${cells[0]}" is not in the vocabulary`);
  }
});
