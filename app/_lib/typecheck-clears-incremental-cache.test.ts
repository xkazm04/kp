// Pins that the `typecheck` gate clears TypeScript's incremental build cache
// (tsconfig.tsbuildinfo) BEFORE it runs `tsc --noEmit`.
//
// WHY: tsconfig.json sets "incremental": true, so tsc persists a
// tsconfig.tsbuildinfo cache between runs. That cache does not re-evaluate
// `typeof import("messages/en.json")` when messages/en.json gains new i18n keys,
// so a stale cache produced ~35 phantom TS2345 errors on the companion.settings.*
// / voiceMode.* namespaces after those keys were added — a RED typecheck gate
// with no real type error (`tsc --noIncremental` exited 0 on the same tree).
// Deleting the cache first forces tsc to re-evaluate the current sources every
// run, which is the whole point of a gate.
//
// NON-VACUOUS: the OLD script was exactly `npm run schemas:gen && tsc --noEmit`
// with no cache-clear step, so every assertion below FAILS against it. The fix
// is what makes them pass.
//
// Runner: Node's built-in test runner with type stripping (see package.json
// test:unit). Import-light on purpose — only node builtins — so it loads without
// better-sqlite3.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
const typecheck = String(pkg.scripts?.typecheck ?? "");
const tsconfig = readFileSync(path.join(REPO_ROOT, "tsconfig.json"), "utf8");

test("tsconfig keeps incremental builds on, so a stale cache is possible", () => {
  // If this ever flips to false the cache-clear becomes dead weight and the
  // rest of this file should be reconsidered — the assertion documents the
  // precondition the fix exists for.
  assert.match(tsconfig, /"incremental"\s*:\s*true/);
});

test("typecheck still type-checks the tree with tsc --noEmit", () => {
  assert.match(typecheck, /tsc\b[^&|]*--noEmit/, "typecheck must still run tsc --noEmit");
});

// Resolve the sequence of shell steps `npm run typecheck` actually runs,
// expanding any `npm run <name>` reference one level into its own script body.
// The stale-cache fix is expressed as a dedicated `clean:tsbuildinfo` step, so a
// naive substring test on `typecheck` alone would miss it — this follows the
// indirection instead of assuming the deletion is inlined.
function expandNpmRun(script: string): string {
  return script.replace(/npm run ([\w:-]+)/g, (whole, name) => {
    const body = pkg.scripts?.[name];
    return typeof body === "string" ? `${whole} { ${body} }` : whole;
  });
}

test("typecheck clears tsconfig.tsbuildinfo BEFORE running tsc", () => {
  const expanded = expandNpmRun(typecheck);
  assert.match(
    expanded,
    /tsconfig\.tsbuildinfo/,
    "typecheck (or a step it invokes) must delete the incremental cache (tsconfig.tsbuildinfo)",
  );
  // Ordering is asserted on the top-level typecheck string: whatever step clears
  // the cache must be sequenced before tsc, so `&&` short-circuit can't skip it
  // and tsc always sees a fresh evaluation.
  const clearStepIdx = typecheck.search(/clean:tsbuildinfo|tsconfig\.tsbuildinfo/);
  const tscIdx = typecheck.search(/tsc\b/);
  assert.ok(
    clearStepIdx !== -1 && tscIdx !== -1 && clearStepIdx < tscIdx,
    "the cache-clear step must be sequenced BEFORE tsc --noEmit",
  );
});
