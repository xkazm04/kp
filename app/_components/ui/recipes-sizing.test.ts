// Source guard for the button recipes' sizing contract. BTN_PRIMARY /
// BTN_SECONDARY / BTN_GHOST deliberately carry NO height/padding — "sizing
// stays at the call site" (recipes.ts) — so a bare `className={BTN_PRIMARY}`
// renders a squished, unpadded button that reads as broken (caught live on the
// intake surface's Send button, 2026-08-07). This walks every .tsx under app/
// and fails on a bare usage: pair the recipe with sizing, e.g.
// `className={`${BTN_PRIMARY} h-9 px-4 text-sm`}`.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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

const BARE = /className=\{(BTN_PRIMARY|BTN_AFFIRM|BTN_SECONDARY|BTN_GHOST)\}/;

test("no bare BTN_* recipe usage — sizing must be paired at the call site", () => {
  const offenders: string[] = [];
  for (const file of walk(APP_DIR)) {
    const src = readFileSync(file, "utf8");
    const match = src.match(BARE);
    if (match) offenders.push(`${path.relative(APP_DIR, file)} (${match[1]})`);
  }
  assert.deepEqual(
    offenders,
    [],
    `bare button recipe usage (pair sizing, e.g. \`\${BTN_PRIMARY} h-9 px-4 text-sm\`):\n${offenders.join("\n")}`
  );
});
