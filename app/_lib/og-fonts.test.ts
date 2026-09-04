// Pins pickFontUrl: a Google css2 response carries one @font-face per unicode-
// range and `latin` is LAST, so grabbing the first src embedded a non-latin
// subset and the OG title rendered as tofu. These lock the "prefer the basic-
// Latin block" behavior so that regression can't return silently.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOgFonts, pickFontUrl } from "./og-fonts.ts";

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

// --- KP_OFFLINE --------------------------------------------------------------
// `grep KP_OFFLINE app/_lib/og-fonts.ts` came back EMPTY on a module whose entire
// job is outbound HTTP to fonts.googleapis.com. The global fetch guard would have
// rejected those calls anyway, so this is not a leak — but "the backstop catches
// it" is how an egress hole hides, and the route still paid for two doomed fetches
// per OG render. These pin the decision being made up front, where a reader (and a
// grep) can see it.
//
// `loadOgFonts` is driven with a fetch that FAILS THE TEST if it is called: the
// assertion is not "the result is empty" (a timeout produces that too) but "no
// network was touched at all".

test("KP_OFFLINE: loadOgFonts returns no descriptors WITHOUT touching the network", async () => {
  const realFetch = globalThis.fetch;
  const before = process.env.KP_OFFLINE;
  process.env.KP_OFFLINE = "1";
  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    throw new Error("og-fonts must not fetch under KP_OFFLINE");
  }) as typeof fetch;
  try {
    const fonts = await loadOgFonts([
      { family: "Fraunces", weight: 700 },
      { family: "Inter", weight: 500 },
    ]);
    // Empty, not null and not a descriptor with `data: null` — ImageResponse takes
    // this array verbatim and renders in its default face.
    assert.deepEqual(fonts, []);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
    if (before === undefined) delete process.env.KP_OFFLINE;
    else process.env.KP_OFFLINE = before;
  }
});

test("KP_OFFLINE honours the same truthy vocabulary as the rest of the app", async () => {
  const realFetch = globalThis.fetch;
  const before = process.env.KP_OFFLINE;
  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.reject(new Error("blocked"));
  }) as unknown as typeof fetch;
  try {
    // isOffline() accepts 1/true/yes/on, case- and space-insensitively.
    for (const flag of ["1", "true", "YES", " on "]) {
      process.env.KP_OFFLINE = flag;
      assert.deepEqual(await loadOgFonts([{ family: "Inter", weight: 500 }]), [], flag);
    }
    assert.equal(calls, 0);

    // …and an ONLINE deployment still goes to the network. A short-circuit that
    // fired for everyone would silently drop the OG typography in production.
    for (const flag of ["0", "false", ""]) {
      process.env.KP_OFFLINE = flag;
      assert.deepEqual(await loadOgFonts([{ family: "Inter", weight: 500 }]), [], flag);
    }
    assert.equal(calls, 3, "an online deployment must still attempt the font fetch");
  } finally {
    globalThis.fetch = realFetch;
    if (before === undefined) delete process.env.KP_OFFLINE;
    else process.env.KP_OFFLINE = before;
  }
});
