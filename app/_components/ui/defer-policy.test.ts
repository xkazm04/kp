// Pins the <Defer> collapse rules — the ones that decide whether a subtree is
// staged at all. Getting these wrong is invisible in review but very visible in
// use: a reduced-motion user seeing content pop in waves, or a chart mounting
// eagerly on a tab nobody scrolled down on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mountsImmediately, QUIET_PLACEHOLDER_DELAY_MS, type DeferStrategy } from "./defer-policy.ts";

const TIMED: DeferStrategy[] = ["next-frame", "idle"];

test("by default nothing mounts immediately — every strategy stages", () => {
  for (const strategy of [...TIMED, "visible" as const]) {
    assert.equal(mountsImmediately({ strategy }), false, `${strategy} stages by default`);
  }
});

test("reduced motion collapses the timed strategies to a single commit", () => {
  for (const strategy of TIMED) {
    assert.equal(mountsImmediately({ strategy, reducedMotion: true }), true, `${strategy} is not staged under reduced motion`);
  }
});

test("reduced motion does NOT force a below-the-fold subtree into the DOM", () => {
  // `visible` is a payload decision, not choreography: honouring reduced motion
  // here would mount every off-screen chart on every tab.
  assert.equal(mountsImmediately({ strategy: "visible", reducedMotion: true }), false);
});

test("the `immediate` escape hatch beats every other rule", () => {
  for (const strategy of [...TIMED, "visible" as const]) {
    assert.equal(mountsImmediately({ strategy, immediate: true }), true);
    assert.equal(mountsImmediately({ strategy, immediate: true, reducedMotion: false }), true);
  }
});

test("the quiet-placeholder delay is long enough to swallow a warm chunk, short enough not to feel stuck", () => {
  // The contract the CSS depends on: below ~100ms placeholders flash on every
  // fast swap; above ~250ms a genuinely slow load looks like a dead page.
  assert.ok(QUIET_PLACEHOLDER_DELAY_MS >= 100 && QUIET_PLACEHOLDER_DELAY_MS <= 250);
});
