// The locale universe and the ONE resolution path every server scope shares.
//
// Nothing in i18n/ had a test before this file. That is a strange gap for the
// module that decides which language a candidate reads their interview invitation
// in: `resolveAcceptLanguage` parses an attacker-supplied header, `isLocale`
// guards a dynamic `import(messages/<locale>.json)` that 404s at runtime on a bad
// value, and `getServerLocale` encodes a precedence (cookie > header > en) that is
// stated in a comment and enforced nowhere.
//
// `getServerLocale` is exercised for real rather than described: only `next/headers`
// is substituted (through a resolution hook, the house shape from
// app/_lib/testing/next-server-hooks.mjs), so the precedence assertions run the
// actual function over the actual guard. `LOCALES` is deliberately NOT hard-coded
// below — the first assertion derives from it, so adding a fifth locale extends the
// coverage instead of reddening it.
//
// Runner: node:test with type stripping. `npm run test:unit i18n/locales.test.ts`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

import { coerceLocale, DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, LOCALES, resolveAcceptLanguage } from "./locales.ts";
import { localeCookieOptions, LOCALE_COOKIE_MAX_AGE } from "./cookie.ts";

// --- the closed vocabulary ---------------------------------------------------

test("isLocale accepts every declared locale and nothing else", () => {
  for (const locale of LOCALES) assert.equal(isLocale(locale), true, locale);

  // The values a cookie, a `?lang=` or a header actually arrives as when it is
  // wrong: a plausible-but-unsupported tag, the regional form (which the CALLER
  // must fold, not this guard), casing, whitespace, and the classic JSON shapes.
  for (const bad of ["es", "EN", "en-US", " en", "en ", "", "e", "english", "../en"]) {
    assert.equal(isLocale(bad), false, JSON.stringify(bad));
  }
  for (const bad of [null, undefined, 0, 1, true, {}, [], ["en"], { toString: () => "en" }]) {
    assert.equal(isLocale(bad), false, String(bad));
  }
});

test("coerceLocale folds a regional tag onto a shipped catalog and rejects the rest", () => {
  // Candidate links and browser pickers emit cs-CZ / en-US; the cookie and
  // `?lang=` writers fold those onto a catalog so the page is Czech, not English.
  assert.equal(coerceLocale("cs-CZ"), "cs");
  assert.equal(coerceLocale("de-AT"), "de");
  assert.equal(coerceLocale("fr-CA"), "fr");
  assert.equal(coerceLocale("DE-de"), "de");
  assert.equal(coerceLocale("en-US"), "en");
  for (const locale of LOCALES) assert.equal(coerceLocale(locale), locale, locale);

  // Unsupported families and path-like junk must not become a catalog name.
  assert.equal(coerceLocale("es-ES"), null);
  assert.equal(coerceLocale("../en"), null);
  assert.equal(coerceLocale("es"), null);
  assert.equal(coerceLocale(""), null);
  for (const bad of [null, undefined, 0, true, {}, [], ["en"]]) {
    assert.equal(coerceLocale(bad), null, String(bad));
  }

  // isLocale stays strict: a regional tag is not a catalog import key.
  assert.equal(isLocale("cs-CZ"), false);
});

test("the default locale is one of the declared locales", () => {
  // Guards the one way DEFAULT_LOCALE can go wrong: a rename of the fallback that
  // leaves it pointing at a catalog that no longer exists.
  assert.equal(isLocale(DEFAULT_LOCALE), true);
  assert.equal(DEFAULT_LOCALE, "en");
});

// --- Accept-Language ---------------------------------------------------------

test("resolveAcceptLanguage: null for no header, garbage, and unsupported tags", () => {
  for (const header of [null, undefined, "", "   ", ",,,", ";q=0.9", "*", "es,it,pt-BR", " "]) {
    assert.equal(resolveAcceptLanguage(header), null, JSON.stringify(header));
  }
});

test("resolveAcceptLanguage folds a regional tag onto its primary subtag", () => {
  assert.equal(resolveAcceptLanguage("cs-CZ"), "cs");
  assert.equal(resolveAcceptLanguage("de-AT"), "de");
  assert.equal(resolveAcceptLanguage("fr-CA"), "fr");
  assert.equal(resolveAcceptLanguage("en-GB"), "en");
  // Case and surrounding whitespace are the browser's business, not a mismatch.
  assert.equal(resolveAcceptLanguage("  DE-de  "), "de");
});

test("resolveAcceptLanguage honours the header's own order, skipping unsupported tags", () => {
  // A real Chrome header: the first SUPPORTED tag wins, not the first tag.
  assert.equal(resolveAcceptLanguage("es-ES,es;q=0.9,cs;q=0.8,en;q=0.7"), "cs");
  // …and the q-values do not need parsing to get that right, because the browser
  // has already sorted the list. This is the assertion that would catch someone
  // "improving" the function into picking the highest q it happens to see first.
  assert.equal(resolveAcceptLanguage("de;q=0.2,fr;q=0.9"), "de");
});

test("resolveAcceptLanguage ignores a q-suffix and empty list entries", () => {
  assert.equal(resolveAcceptLanguage("fr;q=0.5"), "fr");
  assert.equal(resolveAcceptLanguage(",,cs,"), "cs");
});

test("resolveAcceptLanguage skips q=0 tags and never reorders by q", () => {
  // RFC 9110: q=0 means not acceptable. A privacy-minded client forbids English.
  assert.equal(resolveAcceptLanguage("en;q=0,cs"), "cs");
  assert.equal(resolveAcceptLanguage("en;q=0.0,cs"), "cs");
  // The header is already sorted; a lower-q first tag still wins.
  assert.equal(resolveAcceptLanguage("de;q=0.2,fr;q=0.9"), "de");
  assert.equal(resolveAcceptLanguage("fr;q=0.5"), "fr");
  // Malformed q is "present", not a skip.
  assert.equal(resolveAcceptLanguage("en;q=nope,cs"), "en");
  assert.equal(resolveAcceptLanguage("en;q=,cs"), "en");
  // Nothing acceptable falls through.
  assert.equal(resolveAcceptLanguage("en;q=0"), null);
});

// --- the cookie policy -------------------------------------------------------

test("localeCookieOptions is one shape: year-long, site-wide, lax", () => {
  const opts = localeCookieOptions();
  assert.equal(opts.path, "/");
  assert.equal(opts.maxAge, LOCALE_COOKIE_MAX_AGE);
  assert.equal(opts.maxAge, 60 * 60 * 24 * 365);
  // "lax", never "strict": a candidate arriving from a `?lang=cs` link in an email
  // is a cross-site top-level GET, and "strict" withholds the cookie on exactly
  // that navigation.
  assert.equal(opts.sameSite, "lax");
});

test("localeCookieOptions sets secure ONLY in production", () => {
  // NODE_ENV is typed read-only on ProcessEnv; the test has to be able to move it.
  const env = process.env as Record<string, string | undefined>;
  const before = env.NODE_ENV;
  try {
    // A self-hosted install is routinely reached over plain HTTP on a LAN, where a
    // `secure` cookie is silently dropped and the switcher appears to do nothing.
    for (const value of ["development", "test"]) {
      env.NODE_ENV = value;
      assert.equal(localeCookieOptions().secure, false, value);
    }
    env.NODE_ENV = "production";
    assert.equal(localeCookieOptions().secure, true);
  } finally {
    env.NODE_ENV = before;
  }
});

// --- the precedence chain ----------------------------------------------------

// Point `next/headers` at the shim BEFORE server.ts resolves it. The module under
// test is therefore imported dynamically, once, and each case just re-parks the
// jar/header bag the shim reads — no cache-busting, no module reloading.
register(new URL("./testing/next-headers-hooks.mjs", import.meta.url));

type ServerModule = { getServerLocale: () => Promise<string> };
let serverModule: ServerModule | null = null;

/** Drive the real `getServerLocale` with a given cookie + Accept-Language. */
async function serverLocaleWith(cookie: string | undefined, acceptLanguage: string | null): Promise<string> {
  const g = globalThis as unknown as Record<string, unknown>;
  g.__KP_TEST_COOKIES__ = cookie === undefined ? {} : { [LOCALE_COOKIE]: cookie };
  g.__KP_TEST_HEADERS__ = acceptLanguage === null ? {} : { "accept-language": acceptLanguage };
  serverModule ??= (await import("./server.ts")) as ServerModule;
  return serverModule.getServerLocale();
}

test("getServerLocale: a valid cookie wins over the header", async () => {
  assert.equal(await serverLocaleWith("cs", "de-DE,de;q=0.9"), "cs");
  assert.equal(await serverLocaleWith("fr", "en-US"), "fr");
});

test("getServerLocale: no cookie falls through to Accept-Language", async () => {
  assert.equal(await serverLocaleWith(undefined, "de-DE,de;q=0.9,en;q=0.5"), "de");
});

test("getServerLocale: an UNSUPPORTED cookie does not win — it falls through", async () => {
  // The bug this pins: a `cookie ?? header` chain would return "es" here (or throw
  // downstream on import(messages/es.json)). The guard has to run BEFORE the
  // fallthrough decision, not after it.
  assert.equal(await serverLocaleWith("es", "cs-CZ"), "cs");
  assert.equal(await serverLocaleWith("", "cs-CZ"), "cs");
});

test("getServerLocale: nothing usable anywhere resolves to the default", async () => {
  assert.equal(await serverLocaleWith(undefined, null), DEFAULT_LOCALE);
  assert.equal(await serverLocaleWith("es", "pt-BR,it"), DEFAULT_LOCALE);
});
