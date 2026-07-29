import { test } from "node:test";
import assert from "node:assert/strict";
import { navKey, shouldCloseDrawerOnNav } from "./navDrawerClose.ts";

// bug-ui-scan 2026-07-09 (app-shell-navigation #2): only selectTab closed the mobile
// drawer, so tapping a badge's "go to N aging" slice pill or picking a command-palette
// result navigated but left the drawer parked over the new content. The fix closes the
// drawer centrally whenever the navigation key (pathname + search) changes; these pure
// helpers back that effect.

test("navKey composes pathname + search so a search-only tab switch is a new key", () => {
  assert.equal(navKey("/studio", "tab=jobs"), "/studio?tab=jobs");
  assert.notEqual(navKey("/studio", "tab=jobs"), navKey("/studio", "tab=match"));
});

test("navKey with no search is just the pathname (no dangling '?')", () => {
  assert.equal(navKey("/studio", ""), "/studio");
  assert.equal(navKey("/studio", ""), navKey("/studio", ""));
});

test("navKey also distinguishes a cross-route (pathname) navigation", () => {
  assert.notEqual(navKey("/studio", "tab=jobs"), navKey("/jds/abc", "tab=jobs"));
});

// The load-bearing behaviour the pre-fix code lacked: BOTH the badge slice (same tab,
// adds a pre-filter param) and the palette (jump to another tab) are navigations that
// must close the drawer — not just a sidebar tab pick.
test("shouldCloseDrawerOnNav closes on the badge-slice navigation", () => {
  assert.equal(
    shouldCloseDrawerOnNav(navKey("/s", "tab=pipeline"), navKey("/s", "tab=pipeline&stage=aging")),
    true
  );
});

test("shouldCloseDrawerOnNav closes on a command-palette jump to another tab", () => {
  assert.equal(shouldCloseDrawerOnNav(navKey("/s", "tab=jobs"), navKey("/s", "tab=match")), true);
});

test("shouldCloseDrawerOnNav does NOT close when nothing navigated (e.g. the drawer just opened)", () => {
  assert.equal(shouldCloseDrawerOnNav(navKey("/s", "tab=jobs"), navKey("/s", "tab=jobs")), false);
});
