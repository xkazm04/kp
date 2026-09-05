// IS THE SUITE ENGLISH-ONLY BY ACCIDENT?
//
// This app ships four locales and every user-facing string goes through
// next-intl, but until this file every end-to-end assertion in e2e/ was written
// against an English rendering with no cookie set. That is a real blind spot,
// not a theoretical one: `npm run i18n:check` proves the four CATALOGS agree and
// `tsc` proves the KEYS exist, and neither of them can tell you that the running
// app actually resolved a non-default locale and painted it. A regression in the
// cookie precedence, the request config, or the `<html lang>` plumbing would
// leave every catalog gate green and every e2e spec green.
//
// So: one spec, one non-default locale, the shell — the cheapest possible proof
// that the pipe is connected end to end.
//
// Keyless and deterministic: the locale is resolved from a cookie by the server,
// the strings come out of messages/, and the two tabs it opens read SQLite. No
// model call is reachable from here.
//
// THE ASSERTION IS DERIVED, NOT DUPLICATED. The expected Czech strings are read
// out of messages/cs.json at load time rather than pasted in. A pasted string
// makes this file a second catalog that drifts silently the first time a
// translator improves the copy; reading the catalog means the test asks the real
// question — "did the page render what cs.json says?" — and keeps saying so.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LOCALE_COOKIE } from "../i18n/locales";
import { E2E_BASE_URL, seedDevAuth } from "./dev-auth";

const catalog = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.resolve(import.meta.dirname, "..", "messages", `${locale}.json`), "utf8"));

/** `analytics.title` etc. — the dotted key next-intl itself would resolve. */
function message(locale: string, dotted: string): string {
  const value = dotted.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], catalog(locale));
  // Non-vacuity: a typo'd key would otherwise turn every assertion below into
  // `toContain(undefined)`, which is a different (and much quieter) failure.
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`messages/${locale}.json has no string at "${dotted}" — the smoke's own premise is broken`);
  }
  return value;
}

async function enterAs(page: Page, locale: string): Promise<void> {
  await seedDevAuth(page);
  await page.context().addCookies([{ name: LOCALE_COOKIE, value: locale, url: E2E_BASE_URL }]);
}

test.describe("Locale smoke — the shell renders the reader's language", () => {
  test("a cs cookie paints Czech copy and stamps <html lang>", async ({ page }) => {
    await enterAs(page, "cs");
    await page.goto("/?tab=analytics");

    // The heading the English sibling specs match as /pipeline analytics/i.
    await expect(page.getByRole("heading", { name: message("cs", "analytics.title") })).toBeVisible({
      timeout: 20_000,
    });
    // …and the English string must be GONE. Without this the test would still
    // pass on a page that rendered both (a partially-translated tree), which is
    // the failure mode a "does the Czech string appear" check is blind to.
    await expect(page.getByRole("heading", { name: message("en", "analytics.title"), exact: true })).toHaveCount(0);

    // The lang attribute is what a screen reader switches voice on; it is
    // resolved by the same server-side locale read, so it is the cheap
    // corroboration that the string above came from the locale and not from a
    // coincidence.
    await expect(page.locator("html")).toHaveAttribute("lang", "cs");
  });

  test("a second tab is translated too — the locale is the request's, not one page's", async ({ page }) => {
    await enterAs(page, "cs");
    await page.goto("/?tab=library");
    await expect(page.getByRole("heading", { name: message("cs", "library.tab.title") })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("no cookie still resolves English — the control", async ({ page }) => {
    // The other half of the proof. If the app were somehow serving Czech to
    // everyone, the first test would pass and nothing would be wrong with it.
    await seedDevAuth(page);
    await page.goto("/?tab=analytics");
    await expect(page.getByRole("heading", { name: message("en", "analytics.title") })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
