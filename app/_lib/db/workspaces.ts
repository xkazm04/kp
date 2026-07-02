import { ensureDb } from "./core";
import { randomId } from "../random-id";
import { isLocale, type Locale } from "@/i18n/locales";

// Tenant root (P2). The single default workspace exists today (seeded in ensureDb);
// real multi-tenancy will add creation + per-user mapping. Shared connection.
// The single default workspace today (matches the seed + auth/session.DEFAULT_WORKSPACE
// + billing's id). Scoped stores default their optional workspaceId to this, so
// they stay behavior-preserving until real multi-tenancy assigns other workspaces.
export const DEFAULT_WORKSPACE_ID = "workspace";

export type Workspace = { id: string; name: string | null; createdAt: string };

function rowToWorkspace(r: Record<string, unknown>): Workspace {
  return { id: r.id as string, name: (r.name as string) ?? null, createdAt: r.created_at as string };
}

export function listWorkspaces(): Workspace[] {
  const db = ensureDb();
  return (db.prepare(`SELECT * FROM workspaces ORDER BY created_at ASC`).all() as Record<string, unknown>[]).map(rowToWorkspace);
}

export function getWorkspace(id: string): Workspace | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM workspaces WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? rowToWorkspace(r) : null;
}

// The tenant-level comms language default (backlog #34): what a candidate with
// NO stored locale hears from us in. 'cs' matches the ČS seed — the deployed
// tenant is a Czech bank, so an unknown-language candidate gets Czech, not the
// UI's English DEFAULT_LOCALE. Stored per workspace (workspaces.default_locale,
// ADD COLUMN ... DEFAULT 'cs' in core.ts backfills existing rows) so a future
// non-Czech tenant flips one column, not code.
export const WORKSPACE_LOCALE_FALLBACK: Locale = "cs";

/** The workspace's default candidate-comms locale, validated at the read
 *  boundary (a fat-fingered column value degrades to the ČS fallback, never an
 *  unknown catalog import downstream). */
export function getWorkspaceDefaultLocale(id: string = DEFAULT_WORKSPACE_ID): Locale {
  const db = ensureDb();
  const row = db.prepare(`SELECT default_locale FROM workspaces WHERE id = ?`).get(id) as
    | { default_locale?: string | null }
    | undefined;
  const value = row?.default_locale;
  return isLocale(value) ? value : WORKSPACE_LOCALE_FALLBACK;
}

export function createWorkspace(name: string): Workspace {
  const db = ensureDb();
  const id = randomId("ws");
  const cleanName = name.trim().slice(0, 80) || "Untitled workspace";
  const createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)`).run(id, cleanName, createdAt);
  return { id, name: cleanName, createdAt };
}
