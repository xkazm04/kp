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
import { getServerTheme, getTheme, subscribeTheme, THEME_STORAGE_KEY } from "./theme.ts";

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

type StorageHandler = (ev: { key: string | null; newValue: string | null }) => void;

function installThemeDom(): {
  dataset: { theme?: string };
  storageHandlers: StorageHandler[];
  storageWrites: { n: number };
  restore: () => void;
} {
  const dataset: { theme?: string } = {};
  const storageHandlers: StorageHandler[] = [];
  const storageWrites = { n: 0 };
  const g = globalThis as typeof globalThis & { document?: unknown; window?: unknown; localStorage?: unknown };
  const prev = { document: g.document, window: g.window, localStorage: g.localStorage };
  g.document = { documentElement: { dataset } };
  g.window = {
    addEventListener(type: string, handler: StorageHandler) {
      if (type === "storage") storageHandlers.push(handler);
    },
    removeEventListener(type: string, handler: StorageHandler) {
      const i = storageHandlers.indexOf(handler);
      if (i >= 0) storageHandlers.splice(i, 1);
    },
  };
  g.localStorage = {
    setItem() {
      storageWrites.n += 1;
    },
  };
  return {
    dataset,
    storageHandlers,
    storageWrites,
    restore() {
      g.document = prev.document;
      g.window = prev.window;
      g.localStorage = prev.localStorage;
    },
  };
}

test("subscribeTheme registers a storage listener and applies a foreign-tab write", () => {
  const dom = installThemeDom();
  let ticks = 0;
  const unsub = subscribeTheme(() => {
    ticks += 1;
  });
  try {
    assert.equal(dom.storageHandlers.length, 1, "subscribeTheme must bind window storage once");
    assert.equal(getTheme(), "light");

    dom.storageHandlers[0]({ key: THEME_STORAGE_KEY, newValue: "dark" });
    assert.equal(getTheme(), "dark");
    assert.equal(dom.dataset.theme, "dark");
    assert.equal(ticks, 1, "useTheme listeners follow the foreign-tab write");
    assert.equal(dom.storageWrites.n, 0, "a foreign-tab write must not re-write localStorage");

    dom.storageHandlers[0]({ key: THEME_STORAGE_KEY, newValue: "light" });
    assert.equal(getTheme(), "light");
    assert.equal(dom.dataset.theme, undefined);
    assert.equal(ticks, 2);

    const ticksBefore = ticks;
    dom.storageHandlers[0]({ key: "other-key", newValue: "dark" });
    assert.equal(getTheme(), "light");
    assert.equal(ticks, ticksBefore);
  } finally {
    unsub();
    assert.equal(dom.storageHandlers.length, 0, "last unsubscribe unbinds the storage listener");
    dom.restore();
  }
});
