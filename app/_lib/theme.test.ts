// The theme store, and the one string it shares with a file it cannot import.
//
// `THEME_STORAGE_KEY` is declared here AND hand-written into layout.tsx's
// pre-hydration THEME_INIT script (which is a STRING of JavaScript, so nothing
// type-checks it, nothing imports it, and no gate had ever compared the two). The
// failure mode if they drift is silent and nasty: the bootstrap reads a key the
// store never writes, so every visit paints Studio Light for a beat and then flips
// to the operator's saved dark theme after hydration — the exact flash the inline
// script exists to prevent, with no error anywhere.
//
// This file reads layout.tsx as SOURCE (never imports it: it is a server component
// pulling in next/font, next-intl and the whole provider tree) and pins the pair.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getServerTheme, THEME_STORAGE_KEY } from "./theme.ts";

// CRLF here, LF in a fresh worktree — normalize before any anchored matching.
const layoutSrc = readFileSync(new URL("../layout.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the theme storage key is the SAME literal the layout bootstrap reads", () => {
  assert.equal(THEME_STORAGE_KEY, "kp-theme");
  // The bootstrap is a template literal assembled into a <script>; find its
  // localStorage read and pull the key out of it, rather than grepping for the
  // value we already hold (which would pass even if the script read nothing).
  const read = layoutSrc.match(/localStorage\.getItem\((["'])([^"']+)\1\)/);
  assert.ok(read, "layout.tsx must still read the theme from localStorage before hydration");
  assert.equal(
    read![2],
    THEME_STORAGE_KEY,
    "app/layout.tsx's THEME_INIT script and app/_lib/theme.ts must name the SAME storage key"
  );
});

test("exactly one place in the layout reads a theme key", () => {
  // A second reader is how the pair silently re-forks: the test above would still
  // pass while half the bootstrap used the other key.
  const reads = layoutSrc.match(/localStorage\.getItem\(/g) ?? [];
  assert.equal(reads.length, 1, "layout.tsx should read localStorage exactly once (the theme bootstrap)");
});

test("the bootstrap and the store agree on what 'dark' means", () => {
  // Both sides must write the SAME attribute for the same value, or the first
  // client render disagrees with the server-painted DOM.
  assert.ok(
    layoutSrc.includes('document.documentElement.dataset.theme="dark"'),
    "the bootstrap must set data-theme=dark on <html>, which is what globals.css keys off"
  );
  // The server cannot know the visitor's choice, so it renders the default and lets
  // the first client snapshot correct it — the light default is what the bootstrap's
  // "no stored value, no dark media query" branch also produces.
  assert.equal(getServerTheme(), "light");
});
