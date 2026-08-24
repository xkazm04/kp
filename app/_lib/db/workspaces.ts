import { ensureDb } from "./core";
import { randomId } from "../random-id";
import { DEFAULT_ORG_ID } from "./organizations";
import { isLocale, type Locale } from "@/i18n/locales";

// Tenant root (P2). The single default workspace exists today (seeded in ensureDb);
// real multi-tenancy will add creation + per-user mapping. Shared connection.
// The single default workspace today (matches the seed + auth/session.DEFAULT_WORKSPACE
// + billing's id). Scoped stores default their optional workspaceId to this, so
// they stay behavior-preserving until real multi-tenancy assigns other workspaces.
export const DEFAULT_WORKSPACE_ID = "workspace";

// A workspace IS a team (P0): `orgId` is the parent organization it belongs to,
// `type` distinguishes a 'team' from a future org-level pseudo-workspace. Both are
// NULL only on a pre-P0 legacy row until the seed backfill links it to org-default.
export type Workspace = { id: string; name: string | null; orgId: string | null; type: string | null; createdAt: string };

function rowToWorkspace(r: Record<string, unknown>): Workspace {
  return {
    id: r.id as string,
    name: (r.name as string) ?? null,
    orgId: (r.org_id as string) ?? null,
    type: (r.type as string) ?? null,
    createdAt: r.created_at as string,
  };
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

/** Set the workspace's default locale — the org's configured language. Validated
 *  before write so the column can only ever hold a supported locale. This is the
 *  authority available OUTSIDE a request (background automation passes, candidate-
 *  comms fallback via getWorkspaceDefaultLocale); the NEXT_LOCALE cookie is its
 *  request-scoped counterpart. Settings → Organization writes both together. */
export function setWorkspaceDefaultLocale(locale: Locale, id: string = DEFAULT_WORKSPACE_ID): void {
  if (!isLocale(locale)) return;
  const db = ensureDb();
  db.prepare(`UPDATE workspaces SET default_locale = ? WHERE id = ?`).run(locale, id);
}

// First-run onboarding, workspace-level fallback: the authority when the session
// carries NO user claim (open dev mode / operator password — current-user.ts
// resolves userId to null there), so the wizard still fires exactly once per
// tenant. Same per-workspace-scalar shape as default_locale above.
export type WorkspaceOnboardingState = "completed" | "skipped" | null;

export function getWorkspaceOnboardingState(id: string = DEFAULT_WORKSPACE_ID): WorkspaceOnboardingState {
  const db = ensureDb();
  const row = db.prepare(`SELECT onboarding_state FROM workspaces WHERE id = ?`).get(id) as
    | { onboarding_state?: string | null }
    | undefined;
  const value = row?.onboarding_state;
  return value === "completed" || value === "skipped" ? value : null;
}

/** Validated at the write boundary like setWorkspaceDefaultLocale — the column
 *  can only ever hold a known state. "completed" wins over a later "skipped". */
export function setWorkspaceOnboardingState(state: "completed" | "skipped", id: string = DEFAULT_WORKSPACE_ID): void {
  const db = ensureDb();
  if (state === "skipped" && getWorkspaceOnboardingState(id) === "completed") return;
  db.prepare(`UPDATE workspaces SET onboarding_state = ? WHERE id = ?`).run(state, id);
}

// Companion memory consent (WP4) — whether this workspace has agreed that Candi
// may keep a memory on this machine, and how it came about:
//   'connected' the operator adopted a brain that was already on disk
//   'birthed'   they asked for a fresh one at first run
//   null        never asked, or skipped — the dock runs MEMORYLESS
// Same per-workspace-scalar shape as default_locale and onboarding_state, and
// validated at both boundaries for the same reason. This store answers "what was
// recorded"; the RULE that turns it into "may this turn touch the brain" — which
// also honours installs that already have episodes — lives in
// app/_lib/companion-brain.ts, beside the probe it belongs with.
export type CompanionBrainConsent = "connected" | "birthed" | null;

export function getCompanionBrainConsent(id: string = DEFAULT_WORKSPACE_ID): CompanionBrainConsent {
  const db = ensureDb();
  const row = db.prepare(`SELECT companion_brain_consent FROM workspaces WHERE id = ?`).get(id) as
    | { companion_brain_consent?: string | null }
    | undefined;
  const value = row?.companion_brain_consent;
  return value === "connected" || value === "birthed" ? value : null;
}

/** Record consent. Deliberately NOT reversible here: "skip" writes nothing at
 *  all rather than a third state, because a null column and an explicit refusal
 *  behave identically (memory off) and inventing the distinction would mean
 *  claiming to know which one an existing row was. */
export function setCompanionBrainConsent(
  state: "connected" | "birthed",
  id: string = DEFAULT_WORKSPACE_ID
): void {
  const db = ensureDb();
  db.prepare(`UPDATE workspaces SET companion_brain_consent = ? WHERE id = ?`).run(state, id);
}

export function createWorkspace(name: string, orgId: string = DEFAULT_ORG_ID): Workspace {
  const db = ensureDb();
  const id = randomId("ws");
  const cleanName = name.trim().slice(0, 80) || "Untitled workspace";
  const createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO workspaces (id, name, org_id, type, created_at) VALUES (?, ?, ?, 'team', ?)`).run(id, cleanName, orgId, createdAt);
  return { id, name: cleanName, orgId, type: "team", createdAt };
}

/** Rename a team. Same 80-char clamp + empty fallback as createWorkspace, so the
 *  two write paths can't disagree about what a legal name is. Returns the updated
 *  row, or null when no workspace matched. */
export function renameWorkspace(id: string, name: string): Workspace | null {
  const db = ensureDb();
  const cleanName = name.trim().slice(0, 80) || "Untitled workspace";
  const info = db.prepare(`UPDATE workspaces SET name = ? WHERE id = ?`).run(cleanName, id);
  return Number(info.changes) > 0 ? getWorkspace(id) : null;
}

/** The teams a user actually belongs to, in the same created_at order as
 *  listWorkspaces/listWorkspacesByOrg. The membership-filtered counterpart of
 *  listWorkspacesByOrg: GET /api/workspaces shows a plain member THIS, and an
 *  org-wide admin the full org list. */
export function listWorkspacesForUser(userId: string): Workspace[] {
  const db = ensureDb();
  return (
    db
      .prepare(
        `SELECT w.* FROM workspaces w
         JOIN memberships m ON m.workspace_id = w.id
         WHERE m.user_id = ?
         ORDER BY w.created_at ASC`,
      )
      .all(userId) as Record<string, unknown>[]
  ).map(rowToWorkspace);
}

/** All teams in an org (the org's workspace list). */
export function listWorkspacesByOrg(orgId: string): Workspace[] {
  const db = ensureDb();
  return (db.prepare(`SELECT * FROM workspaces WHERE org_id = ? ORDER BY created_at ASC`).all(orgId) as Record<string, unknown>[]).map(
    rowToWorkspace,
  );
}

/** The org a team belongs to (null on an unlinked legacy row). */
export function getWorkspaceOrgId(id: string): string | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT org_id FROM workspaces WHERE id = ?`).get(id) as { org_id?: string | null } | undefined;
  return r?.org_id ?? null;
}
