import { ensureDb } from "./core";
import { randomId } from "../random-id";
import { isLocale, type Locale } from "@/i18n/locales";

// Organizations (P0) — the top tenant boundary: the customer company. Owns the
// subscription (billing, later) and the cross-team reference pool; each workspace
// (a TEAM) belongs to one org via workspaces.org_id. The single seeded org today
// is Česká spořitelna (id 'org-default'), created in ensureDb's seed block.
export const DEFAULT_ORG_ID = "org-default";

export type Organization = {
  id: string;
  name: string;
  domain: string | null;
  defaultLocale: string;
  createdAt: string;
};

function rowToOrg(r: Record<string, unknown>): Organization {
  return {
    id: r.id as string,
    name: r.name as string,
    domain: (r.domain as string) ?? null,
    defaultLocale: (r.default_locale as string) ?? "cs",
    createdAt: r.created_at as string,
  };
}

export function getOrganization(id: string = DEFAULT_ORG_ID): Organization | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM organizations WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? rowToOrg(r) : null;
}

export function listOrganizations(): Organization[] {
  const db = ensureDb();
  return (db.prepare(`SELECT * FROM organizations ORDER BY created_at ASC`).all() as Record<string, unknown>[]).map(rowToOrg);
}

export function createOrganization(name: string, domain?: string | null): Organization {
  const db = ensureDb();
  const id = randomId("org");
  const cleanName = name.trim().slice(0, 120) || "Untitled organization";
  const cleanDomain = domain?.trim().slice(0, 120) || null;
  const createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO organizations (id, name, domain, created_at) VALUES (?, ?, ?, ?)`).run(id, cleanName, cleanDomain, createdAt);
  return { id, name: cleanName, domain: cleanDomain, defaultLocale: "cs", createdAt };
}

export function updateOrganization(id: string, patch: { name?: string; domain?: string | null }): boolean {
  const db = ensureDb();
  const cur = getOrganization(id);
  if (!cur) return false;
  const name = patch.name !== undefined ? patch.name.trim().slice(0, 120) || cur.name : cur.name;
  const domain = patch.domain !== undefined ? patch.domain?.trim().slice(0, 120) || null : cur.domain;
  const info = db.prepare(`UPDATE organizations SET name = ?, domain = ? WHERE id = ?`).run(name, domain, id);
  return Number(info.changes) > 0;
}

/** The org's default candidate-comms locale, validated at write so the column can
 *  only hold a supported locale (mirrors workspaces.default_locale). */
export function setOrganizationLocale(locale: Locale, id: string = DEFAULT_ORG_ID): void {
  if (!isLocale(locale)) return;
  const db = ensureDb();
  db.prepare(`UPDATE organizations SET default_locale = ? WHERE id = ?`).run(locale, id);
}
