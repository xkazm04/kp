// Pins pickFontUrl: a Google css2 response carries one @font-face per unicode-
// range and `latin` is LAST, so grabbing the first src embedded a non-latin
// subset and the OG title rendered as tofu. These lock the "prefer the basic-
// Latin block" behavior so that regression can't return silently.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickFontUrl } from "./og-fonts.ts";

// Trimmed but faithful shape of fonts.googleapis.com/css2 — cyrillic first, latin
// last, each block tagged with its unicode-range.
const GOOGLE_CSS = `
/* cyrillic */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 500;
  src: url(https://fonts.gstatic.com/s/inter/cyrillic.woff2) format('woff2');
  unicode-range: U+0301, U+0400-045F, U+0490-0491;
}
/* latin-ext */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 500;
  src: url(https://fonts.gstatic.com/s/inter/latin-ext.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+0304, U+1E00-1EFF;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 500;
  src: url(https://fonts.gstatic.com/s/inter/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+2000-206F;
}
`;

test("prefers the basic-Latin subset, not the first (cyrillic) block", () => {
  assert.equal(pickFontUrl(GOOGLE_CSS), "https://fonts.gstatic.com/s/inter/latin.woff2");
});

test("strips quotes from the src url", () => {
  const css = `@font-face { src: url("https://x/latin.woff2") format('woff2'); unicode-range: U+0000-00FF; }`;
  assert.equal(pickFontUrl(css), "https://x/latin.woff2");
});

test("falls back to the last src when no block is unicode-range tagged", () => {
  const css = `
    @font-face { src: url(https://x/a.woff2) format('woff2'); }
    @font-face { src: url(https://x/b.woff2) format('woff2'); }
  `;
  assert.equal(pickFontUrl(css), "https://x/b.woff2");
});

test("returns null when no @font-face carries a src url", () => {
  assert.equal(pickFontUrl("/* nothing here */"), null);
});
