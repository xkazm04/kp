// The analytics memo (createAnalyticsCache) is keyed by (workspace, window, WRITE
// VERSION) and its header argues that no write-path invalidation is needed: the TTL is
// seconds, so a pipeline write "lands on the next read past the TTL, well inside a
// recruiter's read cadence". That argument was later qualified for the two analytics write
// doors (/api/analytics/targets, /api/analytics/spend), which reload the instant they
// succeed and would read back the pre-write figure.
//
// WHAT THIS FILE FOUND. The same qualification applies to the decision config, and nothing
// had noticed: the memoized payload READS it. `pipelineAnalytics` resolves the board's
// stage axis through `getPipelineAxis` -> `getDecisionConfig("pipelineStages")`
// (db/analytics.ts:384 and :942), so saving the board shape in Settings -> Hiring changes
// how every funnel figure is grouped while the panel keeps serving figures grouped the OLD
// way for the whole TTL. That is worse than a visibly stale number: it is a consistent,
// wrong one rendered beside the new settings, with nothing saying so.
//
// So the invariant is CONDITIONAL, and stated that way rather than as a wish:
//   the payload may reach the config store ONLY IF the config writers bump the memo's
//   write version.
// Cut the read edge and this file still passes. Add a second config reader to the payload
// without a bump and it does not.
//
// Static, because the claim is a REACHABILITY claim: a behavioural probe can only show the
// config was not read on the path it happened to drive, while an import walk fails the
// moment an edge appears five modules deep, added by someone who never opened this file.
// The behavioural half — that a save really does bump the version — lives beside the store
// in decision-config-isolation.test.ts, where the DB harness already is.
//
// Runner: npm run test:unit

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(APP_ROOT, "..");

/** Resolve one import specifier to a file on disk, or null for a package path we do not
 *  follow. Handles the `@/` alias (repo root) and extensionless relatives — the two shapes
 *  this tree uses. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(REPO_ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // node: builtin or npm package
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx"), base]) {
    try {
      if (existsSync(candidate) && readFileSync(candidate, "utf8").length >= 0) return candidate;
    } catch {
      /* a directory, or unreadable — not a module edge that can be followed */
    }
  }
  return null;
}

/** VALUE imports only. `import type { X }` is erased before anything runs, so a type edge
 *  to the config store is not a READ of it — counting one would fail this test for a
 *  reason that cannot move a single figure. */
function valueImports(file: string): string[] {
  const src = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*import\s+([^;]*?)\s*from\s*["']([^"']+)["']/gm)) {
    if (/^type\b/.test(m[1].trim())) continue;
    const braces = m[1].match(/\{([^}]*)\}/);
    const outsideBraces = m[1].replace(/\{[^}]*\}/, "").replace(/,/g, "").trim();
    if (braces && outsideBraces === "") {
      const names = braces[1].split(",").map((n) => n.trim()).filter(Boolean);
      if (names.length > 0 && names.every((n) => /^type\s/.test(n))) continue;
    }
    out.push(m[2]);
  }
  // Bare side-effect imports (`import "./x"`) run, so they count.
  for (const m of src.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) out.push(m[1]);
  return out;
}

/** Every module transitively reachable by a value import from `entries`, mapped to the
 *  chain that got there — so a failure names the path, not just the endpoint. */
function reachable(entries: string[]): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue: { file: string; path: string[] }[] = entries.map((f) => ({ file: f, path: [f] }));
  while (queue.length > 0) {
    const { file, path } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.set(file, path);
    for (const spec of valueImports(file)) {
      const target = resolveSpecifier(file, spec);
      if (target && !seen.has(target)) queue.push({ file: target, path: [...path, target] });
    }
  }
  return seen;
}

// The memo's whole compute closure (app/api/analytics/route.ts): pipelineAnalytics +
// pipelineAnalyticsPrior over the current and prior windows, folded by periodDeltas.
const PAYLOAD_ENTRIES = [join(APP_ROOT, "_lib", "db", "analytics.ts"), join(APP_ROOT, "_lib", "analytics-deltas.ts")];
const CONFIG_STORE = join(APP_ROOT, "_lib", "decision-config-store.ts");

const short = (f: string) => relative(REPO_ROOT, f).replace(/\\/g, "/");

test("a config read inside the memoized payload obliges the writers to retire the memo", () => {
  for (const entry of PAYLOAD_ENTRIES) assert.ok(existsSync(entry), `${short(entry)} moved — this test points at nothing`);
  const graph = reachable(PAYLOAD_ENTRIES);
  // Non-vacuity: db/analytics.ts alone pulls in the store layer, so a handful of modules
  // means the resolver has stopped resolving and an absence proof would pass for nothing.
  assert.ok(graph.size >= 20, `the import walk reached only ${graph.size} modules — it has stopped resolving`);

  const chain = graph.get(CONFIG_STORE);
  if (!chain) return; // The edge was cut. Nothing to oblige, and that is a valid end state.

  // The edge exists (today: db/analytics.ts -> pipeline-axis-server.ts -> the store, for
  // the board's stage axis), so the store must bump the version the memo is keyed on.
  const src = readFileSync(CONFIG_STORE, "utf8");
  assert.ok(
    src.includes("invalidateAnalyticsWorkspace"),
    `the memoized analytics payload reads the decision config via ${chain.map(short).join(" -> ")}, ` +
      `but ${short(CONFIG_STORE)} never bumps the analytics write version — a save would be answered ` +
      `with figures computed under the old config for the whole TTL. Either cut the read edge or call ` +
      `invalidateAnalyticsWorkspace(workspaceId) after every successful write.`
  );
  // Both writers, not just the one somebody remembered: setDecisionConfig is the composer's
  // save and updateDecisionConfig is the calibration apply-threshold path.
  for (const writer of ["setDecisionConfig", "updateDecisionConfig"]) {
    const body = src.slice(src.indexOf(`export function ${writer}`));
    assert.ok(
      body.slice(0, body.indexOf("\n}")).includes("retireAnalyticsMemo"),
      `${writer} writes the config without retiring the analytics memo`
    );
  }
});

test("the walk would SEE the config store if it were reachable", () => {
  // The guard above short-circuits on absence, and an absence over a broken traversal is
  // no evidence at all. This drives the same machinery from a module that DOES import the
  // store, several hops from its own entry, and requires a hit.
  const prober = join(APP_ROOT, "_lib", "screen-wave.ts");
  assert.ok(existsSync(prober), "screen-wave.ts moved — pick another known config-store consumer");
  assert.ok(
    reachable([prober]).get(CONFIG_STORE),
    "the walk cannot find decision-config-store even from a module that imports it — the resolver is broken"
  );
});

test("every module that retires the analytics memo is one whose write the payload reads", () => {
  // The converse ledger, derived rather than retyped: the write version is what makes the
  // memo answer a fresh figure, so the set of bumpers is a claim about which writes the
  // payload depends on. A new name here is a deliberate edit, not a drive-by.
  const callers: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      // analytics-cache.ts DECLARES the function; naming itself is not a call site.
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && p !== join(APP_ROOT, "_lib", "analytics-cache.ts")) {
        if (readFileSync(p, "utf8").includes("invalidateAnalyticsWorkspace(")) callers.push(short(p));
      }
    }
  };
  walk(APP_ROOT);
  assert.deepEqual(
    callers.sort(),
    [
      // The board's stage axis: read by pipelineAnalytics on every window.
      "app/_lib/decision-config-store.ts",
      // The two inline analytics editors, which reload the instant they succeed.
      "app/api/analytics/spend/route.ts",
      "app/api/analytics/targets/route.ts",
    ],
    "a module started (or stopped) retiring the analytics memo — confirm the payload's inputs still match its invalidation"
  );
});
