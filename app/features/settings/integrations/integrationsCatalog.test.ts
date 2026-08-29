import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CALENDAR_CALLBACK_STATUSES, calendarScopeSlug } from "../../../_lib/calendar/callback-status.ts";
import { GOOGLE_CALENDAR_SCOPES } from "../../../_lib/calendar/google-oauth.ts";
import { ATS_PROVIDERS } from "../../../_lib/ats/connections-store.ts";
import { SIGNATURE_HEADER, SUBSCRIBABLE_EVENTS } from "../../../_lib/ats-webhook.ts";
import { HIRED_EVENT, PULL_ENDPOINT, SIGNATURE_HEADER_DISPLAY, SUBSCRIBABLE_EVENT_ROWS } from "./integrationsWebhookIdentifiers.ts";

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

// The FOURTH code-authoritative vocabulary this context renders. The three above
// (callback statuses, OAuth scopes, ATS providers) were each pinned to their
// canonical list; the webhook event ids were not, even though they are the one
// vocabulary a SAVE is validated against server-side — `ats-config-store.ts`
// rejects an unknown event with `unknown event "…". Allowed: …`, so a drifted
// copy in the checkbox list is the "reads fine, write gets rejected" failure and
// not a cosmetic one. Both directions, same as the others: an id the server does
// not accept is a checkbox that 400s the save, and an id missing here is an
// event the operator cannot subscribe to at all.
test("the webhook event checkboxes cover exactly SUBSCRIBABLE_EVENTS, with copy in every locale", () => {
  const ids = SUBSCRIBABLE_EVENT_ROWS.map((r) => r.id).sort();
  assert.deepEqual(ids, [...SUBSCRIBABLE_EVENTS].sort(), "checkbox ids vs the wire vocabulary");
  // `ping` is deliberately NOT subscribable — it is the test-ping event, and
  // offering it would let an operator subscribe their ATS to kp's own health check.
  assert.equal(ids.includes("ping"), false, "ping is a test event, never a subscription");
  assert.ok(SUBSCRIBABLE_EVENT_ROWS.some((r) => r.id === HIRED_EVENT), "the live-today event must be in the list it is annotated in");

  const expectedKeys = SUBSCRIBABLE_EVENT_ROWS.map((r) => r.key).sort();
  for (const locale of LOCALES) {
    const catalog = load(locale);
    assert.deepEqual(keysAt(catalog, "integrations.webhook.event"), expectedKeys, `${locale}: event label set`);
    for (const key of expectedKeys) {
      const value = at(catalog, `integrations.webhook.event.${key}`);
      assert.equal(typeof value, "string", `${locale}: event.${key} must be a string`);
      assert.ok((value as string).trim().length > 0, `${locale}: event.${key} must not be blank`);
    }
  }
});

// The other two machine identifiers the panel puts on screen. Neither is copy: an
// operator matches the header against their own verification code, and types the
// endpoint. `SIGNATURE_HEADER` cannot be imported by the client component
// (ats-webhook.ts pulls node:crypto), and the route path has no constant at all —
// so this is where the display strings are held to what actually exists.
test("the displayed signature header and pull endpoint match what the server really serves", () => {
  assert.equal(
    SIGNATURE_HEADER_DISPLAY.toLowerCase(),
    SIGNATURE_HEADER.toLowerCase(),
    "the panel's readable casing must name the same header the signer sends"
  );

  // "GET /api/ats/candidate/<entryId>" → the route directory it promises.
  const match = /^GET (\/api\/[^<\s]*)</.exec(PULL_ENDPOINT);
  assert.ok(match, `PULL_ENDPOINT must read as "GET /api/…/<param>", got ${PULL_ENDPOINT}`);
  const dir = path.join(HERE, "..", "..", "..", match![1].replace(/^\//, "").replace(/\/$/, ""));
  const entries = readdirSync(dir, { withFileTypes: true });
  assert.ok(
    entries.some((e) => e.isDirectory() && /^\[.+\]$/.test(e.name)),
    `${match![1]} must hold a dynamic segment for the id the endpoint promises`
  );
});
