import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WORKSPACE_TAB_IDS } from "./tabs.ts";

// Boundary COVERAGE, pinned over the source.
//
// app/_components/ErrorBoundary.test.ts already proves the boundary behaves —
// it renders the catalog fallback, it announces itself, a changed resetKey
// clears the caught error. What nothing proved is that the workspace still
// USES it. Coverage for every tab rests on exactly one wrapper in
// WorkspaceTabChunks.tsx, and a tab rendered outside it (or a boundary lost to
// a refactor) fails the way a missing boundary always fails: silently, until a
// null-deref on a shape-drifted payload blanks the whole workspace — sidebar,
// sim bar and every other tab with it — instead of one panel.
//
// The panel is a `.tsx` the unit runner cannot compile, so the contract is
// pinned over the source text, as app/api/apply/apply-error-hygiene.test.ts
// does for its route.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, "WorkspaceTabChunks.tsx"), "utf8");

const OPEN = "<TranslatedErrorBoundary";
const CLOSE = "</TranslatedErrorBoundary>";

/** The half-open source span the boundary encloses. */
function boundarySpan(): { from: number; to: number; openTag: string } {
  const open = src.indexOf(OPEN);
  const openEnd = src.indexOf(">", open);
  const close = src.indexOf(CLOSE);
  assert.notEqual(open, -1, "the tab panel renders no TranslatedErrorBoundary at all");
  assert.notEqual(close, -1, "the TranslatedErrorBoundary is never closed");
  return { from: openEnd + 1, to: close, openTag: src.slice(open, openEnd + 1) };
}

// The render arms are the entries of the exhaustive TAB_PANELS registry (idea-47b71431,
// challenge-r08 workspace-shell-core/B) — no longer a `navActive === "<id>"` ternary
// chain. The registry is a DECLARATION; what renders is its one lookup, panelFor, whose
// result (or the locked-door panel) must sit inside the boundary.
const REGISTRY_OPEN = "const TAB_PANELS: Record<WorkspaceTabId, ";

/** The TAB_PANELS object literal's source span. */
function registrySpan(): { from: number; to: number } {
  const from = src.indexOf(REGISTRY_OPEN);
  assert.notEqual(from, -1, "the tab panels are not declared as one exhaustive TAB_PANELS registry");
  const to = src.indexOf("\n};", from);
  assert.notEqual(to, -1, "the TAB_PANELS literal is never closed");
  return { from, to };
}

/** Every registry entry id. */
function registryIds(): string[] {
  const { from, to } = registrySpan();
  return [...src.slice(from, to).matchAll(/^ {2}([a-z]+): /gm)].map((m) => m[1]);
}

test("ONE boundary wraps the tab panel — not zero, not one nested inside another", () => {
  assert.equal(src.split(OPEN).length - 1, 1);
  assert.equal(src.split(CLOSE).length - 1, 1);
});

// The whole point of the wrapper: no tab renders outside it. Every mount — an open
// registry panel or the locked-door panel — happens inside the boundary, and the old
// ternary arms (which could be appended after the closing tag) are gone.
test("every tab render sits INSIDE the boundary", () => {
  const { from, to } = boundarySpan();
  const inside = src.slice(from, to);
  assert.match(inside, /choice\.panel\(/, "the open registry panel renders inside the boundary");
  assert.match(inside, /<LockedTabPanel\b/, "the locked-door panel renders inside the boundary");
  assert.equal((src.match(/choice\.panel\(/g) ?? []).length, 1, "the registry panel renders at exactly one site");
  assert.equal((src.match(/<LockedTabPanel\b/g) ?? []).length, 1);
  // Shape fixture: the old defect still reads as a defect to this probe.
  const arm = /navActive === "[a-z]+"/;
  assert.equal(arm.test(`{navActive === "billing" ? <BillingTab /> : null}`), true);
  assert.equal(arm.test(src), false, "a navActive ternary arm is back — render through TAB_PANELS/panelFor");
});

// Coverage is only meaningful if the arms are the whole tab universe. The Record
// type already makes a missing id a tsc error; this pins it at runtime too.
// `history` owns an entry (the analyze panel) though Workspace collapses it onto
// `analyze` before the switch, so the registry has no holes at all.
test("the registry covers the whole tab universe — every id, history included", () => {
  assert.deepEqual([...registryIds()].sort(), [...WORKSPACE_TAB_IDS].sort());
});

// Every code-split tab must be reachable through the registry. A `dynamic(...)`
// import with no entry is a chunk nobody can open — and one mounted outside the
// registry would bypass panelFor's lock.
test("every dynamically imported tab has a registry entry, and only there", () => {
  const imported = [...src.matchAll(/^const (\w+) = dynamic\(/gm)].map((m) => m[1]);
  const { from, to } = registrySpan();
  const registry = src.slice(from, to);
  const armless = imported.filter((name) => !new RegExp(`<${name}\\b`).test(registry));
  assert.deepEqual(armless, [], "these tab chunks are imported but have no TAB_PANELS entry");
  const rest = src.slice(0, from) + src.slice(to);
  const outside = imported.filter((name) => new RegExp(`<${name}\\b`).test(rest));
  assert.deepEqual(outside, [], "these tab chunks are mounted outside their one registry entry");
});

// Without this, a recruiter who crashes Pipeline then switches to Decisions
// inherits Pipeline's fallback and concludes the whole workspace is broken.
test("resetKey is the active tab, so switching tabs clears a caught error", () => {
  assert.match(boundarySpan().openTag, /resetKey=\{navActive\}/);
});

// The fallback copy is 4-locale; `label` picks which noun it names. "tab" is
// the right one here — `panel` would tell a recruiter a panel failed while the
// entire tab is gone.
test("the fallback names the tab, not a panel", () => {
  assert.match(boundarySpan().openTag, /label="tab"/);
});

// The backstop under the shell. The in-workspace boundary catches renders
// BELOW it; a crash in the shell itself (or in any route with no error.tsx of
// its own — /data/[token], /status/[token], /market, /about…) lands here
// instead of on Next's unstyled "Application error" screen. Deleting this file
// is invisible until something crashes, so its existence is part of the same
// coverage claim.
test("the root route boundary is still mounted under the layout", () => {
  const root = readFileSync(path.join(HERE, "..", "..", "error.tsx"), "utf8");
  assert.match(root, /export \{ RouteError as default \}/);
});

test("global-error owns the layout-level crash the root boundary cannot see", () => {
  const global = readFileSync(path.join(HERE, "..", "..", "global-error.tsx"), "utf8");
  assert.match(global, /reportBoundaryError/);
});
