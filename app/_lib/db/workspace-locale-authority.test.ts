// ONE language authority per organization (challenge-r04 db-org-users-channels/A).
//
// The org's language used to be stored N+1 times: a dead `organizations.default_locale`
// nobody read, and one `workspaces.default_locale` copy per team that the Organization
// tab's write fanned out AT CALL TIME. A team created after that write was born with
// the column DEFAULT ('cs'), whatever its org had chosen, and every NULL-locale
// candidate filed into it was written to in Czech.
//
// The shape pinned here (registry technique settings/inherited-default-override):
//   • organizations.default_locale is the source;
//   • workspaces.locale_override is a team's EXPLICIT choice, and its ABSENCE means
//     "follow the org, continuously" — a write detaches, a clear re-attaches;
//   • workspaces.default_locale is kept as a mirror of the resolved value (the
//     downgrade path: an older image that reads only that column hears the same
//     language);
//   • the one-shot backfill changes NO existing team's language (critic ruling).
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { ensureDb } from "./core.ts";
import { createOrganization, getOrganization, setOrganizationLocale, DEFAULT_ORG_ID } from "./organizations.ts";
import * as workspaces from "./workspaces.ts";
import { isLocale } from "@/i18n/locales";

after(() => cleanupUnitDb());

const { createWorkspace, getWorkspaceDefaultLocale, setWorkspaceDefaultLocale, WORKSPACE_LOCALE_FALLBACK } = workspaces;
// Resolved dynamically so this file can be RED (not a load error) before the build.
function clearOverride(id: string): void {
  const fn = (workspaces as Record<string, unknown>).clearWorkspaceLocaleOverride as ((id: string) => void) | undefined;
  assert.equal(typeof fn, "function", "clearWorkspaceLocaleOverride is the re-attach door");
  fn!(id);
}

function legacy(id: string): string | null {
  const r = ensureDb().prepare(`SELECT default_locale AS v FROM workspaces WHERE id = ?`).get(id) as { v: string | null } | undefined;
  return r?.v ?? null;
}

function override(id: string): string | null {
  const r = ensureDb().prepare(`SELECT locale_override AS v FROM workspaces WHERE id = ?`).get(id) as { v: string | null } | undefined;
  return r?.v ?? null;
}

test("1. a team created AFTER the org chose its language inherits it, not the column default", () => {
  const org = createOrganization("Deutsche Firma GmbH");
  setOrganizationLocale("de", org.id);
  const late = createWorkspace("Late team", org.id);
  assert.equal(getWorkspaceDefaultLocale(late.id), "de", "born into a German org, the team speaks German");
  assert.equal(legacy(late.id), "de", "…and the legacy mirror says so too (downgrade path)");
  assert.equal(override(late.id), null, "inheriting is ABSENCE of an override, not a copied value");
});

test("3. a team override is explicit, survives an org change, and clears back to the org", () => {
  const org = createOrganization("Override Org");
  setOrganizationLocale("de", org.id);
  const teamA = createWorkspace("Team A", org.id);
  const teamB = createWorkspace("Team B", org.id);

  setWorkspaceDefaultLocale("en", teamB.id);
  assert.equal(getWorkspaceDefaultLocale(teamB.id), "en", "teamB chose English explicitly");
  assert.equal(getWorkspaceDefaultLocale(teamA.id), "de", "sibling teamA still follows the org");

  setOrganizationLocale("cs", org.id);
  assert.equal(getWorkspaceDefaultLocale(teamA.id), "cs", "a follower moves with the org, continuously");
  assert.equal(getWorkspaceDefaultLocale(teamB.id), "en", "an explicit override is not trampled by the org");
  assert.equal(legacy(teamA.id), "cs", "the follower's legacy mirror moved too");
  assert.equal(legacy(teamB.id), "en", "the override's legacy mirror did not");

  clearOverride(teamB.id);
  assert.equal(override(teamB.id), null);
  assert.equal(getWorkspaceDefaultLocale(teamB.id), "cs", "clearing re-attaches teamB to the org");
  assert.equal(legacy(teamB.id), "cs", "…and re-mirrors the legacy column");
  assert.equal(getOrganization(org.id)!.defaultLocale, "cs");
});

test("5. an unlinked row reads its legacy column; every unsupported value degrades to the fallback", () => {
  const db = ensureDb();
  const unlinked = createWorkspace("Unlinked legacy row", DEFAULT_ORG_ID);
  db.prepare(`UPDATE workspaces SET org_id = NULL, default_locale = 'fr' WHERE id = ?`).run(unlinked.id);
  assert.equal(getWorkspaceDefaultLocale(unlinked.id), "fr", "no org to follow: the legacy column is the answer");
  db.prepare(`UPDATE workspaces SET default_locale = 'zz' WHERE id = ?`).run(unlinked.id);
  assert.equal(getWorkspaceDefaultLocale(unlinked.id), WORKSPACE_LOCALE_FALLBACK, "a corrupt legacy value degrades");

  const org = createOrganization("Corrupt Org");
  const team = createWorkspace("Follower of a corrupt org", org.id);
  db.prepare(`UPDATE organizations SET default_locale = 'xx-KLINGON' WHERE id = ?`).run(org.id);
  assert.equal(getWorkspaceDefaultLocale(team.id), WORKSPACE_LOCALE_FALLBACK, "a corrupt org value degrades");

  const org2 = createOrganization("Sane Org");
  setOrganizationLocale("de", org2.id);
  const team2 = createWorkspace("Corrupt override", org2.id);
  db.prepare(`UPDATE workspaces SET locale_override = 'qq' WHERE id = ?`).run(team2.id);
  assert.equal(getWorkspaceDefaultLocale(team2.id), WORKSPACE_LOCALE_FALLBACK, "a corrupt override degrades, never an unknown locale");

  assert.equal(getWorkspaceDefaultLocale("ws-that-does-not-exist"), WORKSPACE_LOCALE_FALLBACK);
});

test("6. the migration changes NO existing team's language, and a second boot is a no-op", () => {
  const holder = globalThis as typeof globalThis & { __kpDb?: { close(): void } };
  const db = ensureDb();

  // A pre-migration DB, several teams in different languages across two orgs. The
  // org rows hold the blank 'cs' default nothing ever wrote — the dead authority.
  db.prepare(`UPDATE workspaces SET created_at = '2000-01-01T00:00:00.000Z', default_locale = 'en' WHERE id = 'workspace'`).run();
  const insert = db.prepare(`INSERT INTO workspaces (id, name, org_id, type, created_at, default_locale) VALUES (?, ?, ?, 'team', ?, ?)`);
  insert.run("ws-late", "Late team", DEFAULT_ORG_ID, "2099-01-01T00:00:00.000Z", "cs");
  insert.run("ws-de", "German team", DEFAULT_ORG_ID, "2099-01-02T00:00:00.000Z", "de");
  db.prepare(`INSERT INTO organizations (id, name, domain, created_at) VALUES ('org-mig', 'Migration Org', NULL, '2000-01-01T00:00:00.000Z')`).run();
  insert.run("ws-mig-fr", "Oldest in org-mig", "org-mig", "2001-01-01T00:00:00.000Z", "fr");
  insert.run("ws-mig-en", "English in org-mig", "org-mig", "2001-01-02T00:00:00.000Z", "en");
  insert.run("ws-mig-zz", "Corrupt in org-mig", "org-mig", "2001-01-03T00:00:00.000Z", "zz");

  // Rewind to the pre-migration schema and state: no override column, no mark, every
  // org row at its never-written default.
  db.exec(`ALTER TABLE workspaces DROP COLUMN locale_override`);
  db.prepare(`DELETE FROM seed_marks WHERE name = 'org-locale-authority'`).run();
  db.prepare(`UPDATE organizations SET default_locale = 'cs'`).run();

  // What each team reads TODAY: the old resolver was "legacy column, validated".
  const before = new Map(
    (db.prepare(`SELECT id, default_locale AS v FROM workspaces`).all() as { id: string; v: string | null }[]).map((r) => [
      r.id,
      isLocale(r.v) ? r.v : WORKSPACE_LOCALE_FALLBACK,
    ]),
  );
  assert.ok(before.size >= 6, "the fixture has several teams");

  holder.__kpDb!.close();
  delete holder.__kpDb;
  ensureDb(); // boot the migration

  assert.equal(getOrganization(DEFAULT_ORG_ID)!.defaultLocale, "en", "the org row is seeded from its OLDEST team");
  assert.equal(override("ws-late"), "cs", "a team that differs from its org gets an explicit override");
  assert.equal(override("ws-de"), "de");
  assert.equal(override("workspace"), null, "the team the org was seeded from simply follows it");
  assert.equal(getOrganization("org-mig")!.defaultLocale, "fr");
  assert.equal(override("ws-mig-en"), "en");
  // Copied VERBATIM, never interpreted: the resolver validates the same string the old
  // reader validated, which is what makes "reads exactly as before" hold by construction.
  assert.equal(override("ws-mig-zz"), "zz", "a corrupt legacy value is stamped verbatim");
  for (const [id, locale] of before) {
    assert.equal(getWorkspaceDefaultLocale(id), locale, `team ${id} must read exactly what it read before the migration`);
  }

  // Second boot: the backfill recorded that it ran, so an org language written since
  // is never re-derived from the oldest team.
  setOrganizationLocale("de", DEFAULT_ORG_ID);
  holder.__kpDb!.close();
  delete holder.__kpDb;
  ensureDb();
  assert.equal(getOrganization(DEFAULT_ORG_ID)!.defaultLocale, "de", "the backfill is one-shot, recorded in seed_marks");
  assert.equal(getWorkspaceDefaultLocale("workspace"), "de", "the follower follows the new org value");
  assert.equal(getWorkspaceDefaultLocale("ws-late"), "cs", "the stamped override still holds");
});
