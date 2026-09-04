// THE SHELL'S RESPONSE CONTRACT, over the wire.
//
// app/shell-headers.test.ts pins what the SOURCES say (next.config.ts's header
// list, proxy.ts's policy builder, the theme bootstrap's exempt list). That is
// half the story: a config can be perfect and the header still never reach a
// browser — Next applies `headers()` per matched route, the proxy's `matcher`
// decides where the CSP is minted at all, and the pre-paint theme script only
// works if it EXECUTES before first paint. None of that is observable without a
// real response and a real browser, which is what this file is.
//
// Three contracts:
//   1. Security headers actually arrive on a document response, and exactly one
//      Content-Security-Policy header does, carrying a nonce and no
//      'unsafe-inline' in script-src.
//   2. `<html lang>` follows the resolved locale — from `?lang=` (the proxy
//      translates it into the NEXT_LOCALE cookie) and then from the cookie the
//      proxy set, on a later navigation with no query string.
//   3. No theme flash: with `kp-theme` seeded to "dark" BEFORE the first
//      document loads, `data-theme="dark"` is already on <html> at first paint —
//      and on the fixed-art marketing pages it is never set at all.
//
// Fully deterministic and keyless: nothing here renders model output. Part of
// the keyless CI subset — see .claude/CLAUDE.md and ci.yml.
import { expect, test } from "@playwright/test";
import { E2E_BASE_URL, seedDevAuth } from "./dev-auth";

const LOCALES = ["en", "cs", "de", "fr"] as const;

test.describe("security headers", () => {
  test("every documented header arrives on a document response", async ({ request }) => {
    const res = await request.get("/", { maxRedirects: 0 });
    expect(res.status()).toBeLessThan(400);
    const h = res.headers();
    expect(h["strict-transport-security"]).toBe("max-age=63072000; includeSubDomains; preload");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["permissions-policy"]).toBe("camera=(), microphone=(self), geolocation=()");
  });

  test("one nonce'd, report-only CSP — never two policies, never 'unsafe-inline' scripts", async ({
    request
  }) => {
    const res = await request.get("/", { maxRedirects: 0 });
    const headers = res.headersArray();
    // Two Content-Security-Policy headers on one response are two policies BOTH
    // applying, and the effective result is neither author's. The policy moved
    // out of next.config.ts into proxy.ts precisely so there is one producer.
    const policies = headers.filter((x) => /^content-security-policy/i.test(x.name));
    expect(policies.map((p) => p.name.toLowerCase())).toEqual(["content-security-policy-report-only"]);

    const csp = policies[0]!.value;
    const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src "));
    expect(scriptSrc, `no script-src in: ${csp}`).toBeTruthy();
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]{16,}'/);
    expect(csp).toContain("frame-ancestors 'none'");
  });

  test("the pre-paint theme script carries the request's nonce", async ({ request }) => {
    const res = await request.get("/", { maxRedirects: 0 });
    const nonce = /'nonce-([^']+)'/.exec(res.headers()["content-security-policy-report-only"] ?? "")?.[1];
    expect(nonce, "the response advertised a nonce").toBeTruthy();
    const html = await res.text();
    // The one inline <script> this app writes by hand (app/layout.tsx's
    // THEME_INIT). Without the nonce it is exactly what an enforced policy would
    // block, and the whole point of the move would be undone silently.
    const themeScript = /<script[^>]*>\(function\(\)\{try\{var p=location\.pathname/.exec(html)?.[0];
    expect(themeScript, "the theme bootstrap is inline in the document").toBeTruthy();
    expect(themeScript).toContain(`nonce="${nonce}"`);
  });

  test("a legacy /favicon.ico probe is answered, not 404'd", async ({ request }) => {
    const res = await request.get("/favicon.ico");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/");
  });
});

test.describe("locale resolution", () => {
  for (const locale of LOCALES) {
    test(`?lang=${locale} sets <html lang> and sticks for the next navigation`, async ({ page }) => {
      await seedDevAuth(page);
      await page.goto(`/?lang=${locale}`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      // The proxy translated ?lang into NEXT_LOCALE; a query-less navigation must
      // now resolve the same way (this is what a candidate's second click does).
      await page.goto("/about");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
    });
  }

  test("a page advertises its four language alternates and an x-default", async ({ page }) => {
    await seedDevAuth(page);
    await page.goto("/about");
    for (const locale of LOCALES) {
      const href = await page
        .locator(`link[rel="alternate"][hreflang="${locale}"]`)
        .getAttribute("href");
      expect(href, `hreflang=${locale} is declared`).toBeTruthy();
      // Per-route, not pinned to the site root: this is /about's alternate.
      // (Next serializes the resolved URL with a trailing slash before the
      // query — `/about/?lang=en` — so normalise it rather than pin the shape.)
      expect(new URL(href!).pathname.replace(/\/$/, "")).toBe("/about");
      expect(new URL(href!).searchParams.get("lang")).toBe(locale);
    }
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveCount(1);
  });
});

test.describe("theme bootstrap", () => {
  test("a stored dark choice is on <html> before the workspace paints", async ({ page }) => {
    await seedDevAuth(page);
    // Seed localStorage on the origin BEFORE the first document of the run, so
    // the inline script reads it on its very first execution. An `addInitScript`
    // runs before any page script, which is the only way to observe the
    // pre-paint state rather than the post-hydration one.
    await page.addInitScript(() => window.localStorage.setItem("kp-theme", "dark"));
    await page.goto("/?tab=hiring");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // The attribute must be there from the server's first paint, not applied by
    // a React effect: the document Playwright received already has it.
    const raw = await page.request.get("/?tab=hiring");
    expect(await raw.text()).toContain("var p=location.pathname");
  });

  test("a stored dark choice never reaches a fixed-art marketing page", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("kp-theme", "dark"));
    // /market renders app/landing/ art (literal hexes, no `dark:` variants), so
    // `data-theme="dark"` there re-skins the neutrals under artwork that cannot
    // follow. It was missing from the exempt list until this contract existed.
    for (const path of ["/about", "/market"]) {
      await page.goto(path);
      await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
    }
    // '/' is the landing for a visitor who has not entered the workspace — same
    // exemption, decided by the kp_entered cookie rather than the path.
    await page.context().clearCookies();
    await page.goto(E2E_BASE_URL);
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
  });
});
