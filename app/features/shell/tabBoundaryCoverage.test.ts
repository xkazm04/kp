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
// USES it. Coverage for all 24 tabs rests on exactly one wrapper in
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

/** Every `navActive === "<id>"` render arm, with where it sits in the file. */
function renderArms(): { id: string; at: number }[] {
  return [...src.matchAll(/navActive === "([a-z]+)"/g)].map((m) => ({ id: m[1], at: m.index }));
}

test("ONE boundary wraps the tab panel — not zero, not one nested inside another", () => {
  assert.equal(src.split(OPEN).length - 1, 1);
  assert.equal(src.split(CLOSE).length - 1, 1);
});

// The whole point of the wrapper: no tab renders outside it. A new tab appended
// after the closing tag would render fine and crash the shell.
test("every tab render arm sits INSIDE the boundary", () => {
  const { from, to } = boundarySpan();
  const outside = renderArms().filter((arm) => arm.at < from || arm.at > to);
  assert.deepEqual(outside, [], "these tabs render outside the error boundary");
});

// Coverage is only meaningful if the arms are the whole tab universe. `history`
// is the one id the panel never sees: Workspace collapses it onto `analyze`
// (which reads `active` for its history mode), so navActive is never "history".
test("the boundary covers the whole tab universe — every id but the collapsed `history`", () => {
  const rendered = new Set(renderArms().map((arm) => arm.id));
  const expected = WORKSPACE_TAB_IDS.filter((id) => id !== "history");
  assert.deepEqual([...rendered].sort(), [...expected].sort());
  assert.equal(rendered.has("history"), false);
});

// Every code-split tab must be reachable through the switch. A `dynamic(...)`
// import with no arm is a chunk nobody can open; the pairing is what makes the
// arm count above equal to the tab count.
test("every dynamically imported tab has a render arm", () => {
  const imported = [...src.matchAll(/^const (\w+) = dynamic\(/gm)].map((m) => m[1]);
  const armless = imported.filter((name) => !new RegExp(`<${name}\\b`).test(src.slice(boundarySpan().from)));
  assert.deepEqual(armless, [], "these tab chunks are imported but never rendered inside the boundary");
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
