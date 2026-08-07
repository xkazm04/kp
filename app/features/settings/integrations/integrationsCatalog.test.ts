import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CALENDAR_CALLBACK_STATUSES, calendarScopeSlug } from "../../../_lib/calendar/callback-status.ts";
import { GOOGLE_CALENDAR_SCOPES } from "../../../_lib/calendar/google-oauth.ts";
import { ATS_PROVIDERS } from "../../../_lib/ats/connections-store.ts";

// connect-the-integrations — SET-EQUALITY guards between the code's canonical enums and
// the i18n catalog, in EVERY locale.
//
// Why this test exists and why it checks all four locales rather than `en`: a previous
// round shipped a 4-key catalog against a 13-kind vocabulary, and 23 of 40 rows rendered
// English inside a German UI — through three green gates, because `i18n:check` only proves
// the locales agree WITH EACH OTHER. Four identically-incomplete catalogs are in perfect
// parity. Only a comparison against the code's own list catches it.
//
// Set EQUALITY, not containment, in both directions: a missing key is a blank banner after
// an OAuth redirect the operator cannot cheaply repeat, and an EXTRA key is a status code
// that was renamed or deleted in the route while its copy lingered — the drift that makes
// a catalog untrustworthy to read.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MESSAGES = path.join(HERE, "..", "..", "..", "..", "messages");

type Catalog = Record<string, unknown>;

const LOCALES = readdirSync(MESSAGES)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

function load(locale: string): Catalog {
  return JSON.parse(readFileSync(path.join(MESSAGES, `${locale}.json`), "utf8")) as Catalog;
}

/** Read a dotted path out of a catalog, or undefined. */
function at(catalog: Catalog, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((node, seg) => {
    if (node && typeof node === "object" && seg in (node as Catalog)) return (node as Catalog)[seg];
    return undefined;
  }, catalog);
}

const keysAt = (catalog: Catalog, dotted: string): string[] => {
  const node = at(catalog, dotted);
  assert.ok(node && typeof node === "object", `${dotted} must be an object`);
  return Object.keys(node as Catalog).sort();
};

test("every locale catalog exists and the locale list is non-trivial", () => {
  assert.ok(LOCALES.length >= 4, `expected at least 4 locales, found ${LOCALES.join(", ")}`);
});

// The nine outcomes app/api/calendar/google/callback/route.ts can redirect with. `unknown`
// is the extra, deliberate entry: the fallback for a code this UI version does not know.
test("integrations.calendar.callback covers exactly the canonical status codes, in every locale", () => {
  const expected = [...CALENDAR_CALLBACK_STATUSES, "unknown"].sort();
  for (const locale of LOCALES) {
    const catalog = load(locale);
    assert.deepEqual(keysAt(catalog, "integrations.calendar.callback"), expected, `${locale}: callback status set`);
    for (const status of expected) {
      for (const part of ["title", "body"]) {
        const value = at(catalog, `integrations.calendar.callback.${status}.${part}`);
        assert.equal(typeof value, "string", `${locale}: callback.${status}.${part} must be a string`);
        assert.ok((value as string).trim().length > 0, `${locale}: callback.${status}.${part} must not be blank`);
      }
    }
  }
});

// missingScopes renders one row per scope the grant did not include; each needs a name.
test("integrations.calendar.scopes covers exactly the requested Google scopes, in every locale", () => {
  const expected = GOOGLE_CALENDAR_SCOPES.map(calendarScopeSlug).sort();
  assert.deepEqual(expected, ["events", "freebusy"], "scope slugs derive from the canonical scope URLs");
  for (const locale of LOCALES) {
    assert.deepEqual(keysAt(load(locale), "integrations.calendar.scopes"), expected, `${locale}: scope label set`);
  }
});

test("integrations.ats.providers covers exactly ATS_PROVIDERS, in every locale", () => {
  const expected = [...ATS_PROVIDERS].sort();
  for (const locale of LOCALES) {
    assert.deepEqual(keysAt(load(locale), "integrations.ats.providers"), expected, `${locale}: ATS provider label set`);
  }
});
