// Locale resolution for candidate comms (backlog #34 / pa-l2-null-locale),
// against an ISOLATED throwaway DB (testing/unit-db.ts must stay the first
// project import). Pins the three-tier contract:
//   explicit entry locale > workspace default (cs for the ČS seed) > never "en"
// for a NULL-locale entry unless the workspace says so.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { inferLocaleFromLanguages, inferProfileLocale, resolveCommsLocale } from "./comms-locale.ts";
import { ensureDb } from "./db/core.ts";
import { getWorkspaceDefaultLocale, DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";
import { saveProfile } from "./db/profiles.ts";

after(() => cleanupUnitDb());

test("an explicit entry locale is kept verbatim — en stays en, cs stays cs", () => {
  assert.equal(resolveCommsLocale("en"), "en");
  assert.equal(resolveCommsLocale("cs"), "cs");
});

test("a NULL/absent/garbage locale resolves to the workspace default (cs for the ČS seed)", () => {
  assert.equal(getWorkspaceDefaultLocale(), "cs", "the seeded default workspace defaults to cs");
  assert.equal(resolveCommsLocale(null), "cs");
  assert.equal(resolveCommsLocale(undefined), "cs");
  assert.equal(resolveCommsLocale(""), "cs");
  assert.equal(resolveCommsLocale("xx-KLINGON"), "cs");
});

test("the workspace default is a per-tenant lever: flipping the column flips the NULL fallback", () => {
  const db = ensureDb();
  db.prepare(`UPDATE workspaces SET default_locale = 'en' WHERE id = ?`).run(DEFAULT_WORKSPACE_ID);
  try {
    assert.equal(resolveCommsLocale(null), "en", "NULL now falls back to the tenant's en");
    assert.equal(resolveCommsLocale("cs"), "cs", "an explicit choice still wins over the tenant default");
    // A corrupt column value degrades to the ČS fallback, never an unknown catalog.
    db.prepare(`UPDATE workspaces SET default_locale = 'zz' WHERE id = ?`).run(DEFAULT_WORKSPACE_ID);
    assert.equal(getWorkspaceDefaultLocale(), "cs");
  } finally {
    db.prepare(`UPDATE workspaces SET default_locale = 'cs' WHERE id = ?`).run(DEFAULT_WORKSPACE_ID);
  }
});

test("inferLocaleFromLanguages mirrors Python's _candidate_lang: Czech ⇒ cs, non-Czech ⇒ en, no signal ⇒ null", () => {
  assert.equal(inferLocaleFromLanguages(["Czech (native)", "English (B2)"]), "cs");
  assert.equal(inferLocaleFromLanguages(["čeština"]), "cs");
  assert.equal(inferLocaleFromLanguages(["English", "German"]), "en");
  assert.equal(inferLocaleFromLanguages([]), null);
  assert.equal(inferLocaleFromLanguages(null), null);
  assert.equal(inferLocaleFromLanguages(undefined), null);
  // Non-string junk in the list never throws and carries no signal.
  assert.equal(inferLocaleFromLanguages([42 as unknown as string]), null);
});

test("inferProfileLocale reads the saved profile's CV languages; unknown/missing profiles carry no signal", () => {
  const czech = saveProfile({
    label: "Jana Novák",
    archetype: "bau",
    roleFamily: "software_engineering",
    completeness: 0.9,
    payload: { languages: ["Czech (native)", "English (B2)"] },
  });
  const english = saveProfile({
    label: "John Doe",
    archetype: "bau",
    roleFamily: "software_engineering",
    completeness: 0.9,
    payload: { languages: ["English (native)"] },
  });
  assert.equal(inferProfileLocale(czech.id), "cs");
  assert.equal(inferProfileLocale(english.id), "en");
  assert.equal(inferProfileLocale("no-such-profile"), null);
  assert.equal(inferProfileLocale(null), null);
});
