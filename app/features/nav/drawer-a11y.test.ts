import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isDrawerContentInteractive,
  isDrawerInert,
  isMainInert,
  shouldTrapDrawerFocus,
} from "./drawer-a11y.ts";

// bug-ui-scan 2026-07-09 (app-shell-navigation #1): the mobile nav drawer hid via
// `-translate-x-full` only, so when COLLAPSED its whole subtree stayed in the tab
// order / a11y tree (the hamburger's aria-expanded=false lied), and when OPEN <main>
// wasn't inert so there was no focus trap. These predicates gate inert/trap on
// isMobile so the fix can't regress the always-visible desktop rail.

// The load-bearing truth: the collapsed MOBILE drawer is the ONLY inert state, and
// the ONLY case where content is NOT interactive.
test("collapsed mobile drawer is inert and its content is not interactive", () => {
  assert.equal(isDrawerContentInteractive(true, false), false);
  assert.equal(isDrawerInert(true, false), true);
});

test("open mobile drawer is interactive (not inert)", () => {
  assert.equal(isDrawerContentInteractive(true, true), true);
  assert.equal(isDrawerInert(true, true), false);
});

// Desktop (md+): the rail is permanently visible — it must NEVER be inert regardless
// of the drawer-open flag (which is meaningless above md). This is the regression the
// naive `inert={!open}` fix would have caused.
test("desktop rail is never inert and always interactive, for either open flag", () => {
  for (const open of [false, true]) {
    assert.equal(isDrawerContentInteractive(false, open), true, `open=${open}`);
    assert.equal(isDrawerInert(false, open), false, `open=${open}`);
  }
});

// <main> is inert (focus-trapped) EXCLUSIVELY while the mobile drawer is open.
test("main is inert only when the mobile drawer is open", () => {
  assert.equal(isMainInert(true, true), true);
  assert.equal(isMainInert(true, false), false);
  assert.equal(isMainInert(false, true), false, "desktop is never trapped");
  assert.equal(isMainInert(false, false), false);
});

// The focus-trap controller mounts on exactly the same condition.
test("focus trap engages only for the open mobile drawer", () => {
  assert.equal(shouldTrapDrawerFocus(true, true), true);
  assert.equal(shouldTrapDrawerFocus(true, false), false);
  assert.equal(shouldTrapDrawerFocus(false, true), false);
  assert.equal(shouldTrapDrawerFocus(false, false), false);
});
