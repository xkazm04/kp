// A stand-in for `next/headers`, so the ONE server-side locale resolution path
// (i18n/server.ts) can be driven by a unit test instead of only by a running app.
//
// The real module throws outside a request scope — it reads Next's async storage —
// so `getServerLocale` was untestable and its precedence (cookie > Accept-Language
// > en) lived in a comment. This shim serves whatever the test parked on the two
// globals below, which keeps the substitution to one seam: the test still calls
// the REAL getServerLocale and the real isLocale/resolveAcceptLanguage under it.
//
// Registered through next-headers-hooks.mjs, which must run BEFORE the dynamic
// import of the module under test (resolution hooks only affect later resolutions
// — the same shape as app/_lib/testing/next-server-hooks.mjs).

/** Cookie jar for the next `cookies()` call: `{ NEXT_LOCALE: "cs" }`. */
export async function cookies() {
  const g = globalThis;
  if (!g.__KP_TEST_COOKIES__) g.__KP_TEST_COOKIES__ = {};
  const jar = g.__KP_TEST_COOKIES__;
  return {
    get(name) {
      return Object.prototype.hasOwnProperty.call(jar, name) ? { name, value: jar[name] } : undefined;
    },
    set(name, value) {
      jar[name] = value;
    },
    delete(nameOrOpts) {
      const name = typeof nameOrOpts === "string" ? nameOrOpts : nameOrOpts?.name;
      if (typeof name === "string") delete jar[name];
    },
  };
}

/** Request headers for the next `headers()` call, keyed lower-case. */
export async function headers() {
  const bag = globalThis.__KP_TEST_HEADERS__ ?? {};
  return {
    get(name) {
      return bag[String(name).toLowerCase()] ?? null;
    },
  };
}
