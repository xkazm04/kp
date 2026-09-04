// board-storage-is-keyed-by-tenant — the board's two localStorage-backed memories
// (saved views, per-stage SLA overrides), keyed PER WORKSPACE.
//
// THE LEAK. Both lived under one bare, browser-wide key (`kp.pipelineViews`,
// `kp.pipelineStageSla`) and localStorage is scoped to the ORIGIN, not to the
// session. So after switching teams in Settings → Workspaces, tenant A's
// recruiter-authored view NAMES ("Berlin seniors — waiting on Ada") and the stage
// ids they encode hydrated into tenant B's board; worse, a view A had marked as
// DEFAULT auto-applied A's filter combination on a bare visit, so B opened on a
// board someone else composed. The shell's Recent list had exactly this defect and
// exactly this fix (app/features/shell/recents.ts): the tenant is part of the key,
// and NOTHING is read until we know which tenant we are in.
//
// Everything here except the resolver is pure and takes its `Storage` as an
// argument, so pipelineBoardStorage.test.ts can prove the cross-tenant invariant
// with no DOM.
//
// (Deliberate duplication of the recents resolver: recents.ts is shell-owned and
// outside this lot's write set, and it exports its list API rather than the
// resolve. Hoisting the two into one `useTenantStorage` is the follow-up.)

import { normalizeStoredViews } from "./pipelineViews";
import { clampSlaDays } from "./pipelineSla";
import type { SavedView } from "./pipelineBoardFilters";

const VIEWS_PREFIX = "kp.pipelineViews:";
const SLA_PREFIX = "kp.pipelineStageSla:";

/** The pre-tenancy keys. Unlike recents (which DROPS its legacy list, because a
 *  recent is a name someone else's team opened), a saved view / SLA override is
 *  the CURRENT operator's own configuration in the overwhelming case — a single
 *  workspace install, where the browser has only ever seen one team. So it is
 *  migrated ONCE into whichever workspace resolves first and then removed, rather
 *  than thrown away; from that moment on it can never be read by a second tenant
 *  because the key it now lives under names the first. */
export const LEGACY_VIEWS_KEY = "kp.pipelineViews";
export const LEGACY_SLA_KEY = "kp.pipelineStageSla";

/** Storage key for one workspace's saved views. */
export function pipelineViewsKey(workspaceId: string): string {
  return VIEWS_PREFIX + workspaceId;
}
/** Storage key for one workspace's per-stage SLA overrides. */
export function pipelineSlaKey(workspaceId: string): string {
  return SLA_PREFIX + workspaceId;
}

/** A localStorage-shaped surface, so the pure half is testable. */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Move a legacy global value into the tenant's key ONCE, then remove it.
 *  An existing tenant value always wins (never clobber this team's own list with
 *  whatever the browser held before tenancy). Returns true when it migrated. */
export function migrateLegacyKey(store: KeyValueStore, legacyKey: string, tenantKey: string): boolean {
  try {
    const legacy = store.getItem(legacyKey);
    if (legacy == null) return false;
    const migrated = store.getItem(tenantKey) == null;
    if (migrated) store.setItem(tenantKey, legacy);
    store.removeItem(legacyKey);
    return migrated;
  } catch {
    return false; // storage unavailable — nothing to migrate and nothing to clean up
  }
}

/** Read one workspace's saved views. `null` tenant ⇒ [] — the whole point: until
 *  the workspace resolves, a board hydrates NOTHING rather than another team's list. */
export function readStoredViews(store: KeyValueStore, workspaceId: string | null): SavedView[] {
  if (!workspaceId) return [];
  try {
    const raw = store.getItem(pipelineViewsKey(workspaceId));
    return raw ? normalizeStoredViews(JSON.parse(raw)) : [];
  } catch {
    return []; // corrupt / unavailable — start empty
  }
}

/** Persist one workspace's saved views. A `null` tenant writes NOTHING (a list we
 *  cannot attribute to a team must not be written "somewhere"). */
export function writeStoredViews(store: KeyValueStore, workspaceId: string | null, views: readonly SavedView[]): void {
  if (!workspaceId) return;
  try {
    store.setItem(pipelineViewsKey(workspaceId), JSON.stringify(views));
  } catch {
    /* storage full / unavailable — the in-memory list still works this session */
  }
}

/** Read one workspace's SLA overrides, clamped on the way IN (a value stored by an
 *  older build that accepted anything positive must not silence a column forever). */
export function readStoredSla(store: KeyValueStore, workspaceId: string | null): Record<string, number> {
  if (!workspaceId) return {};
  try {
    const raw = store.getItem(pipelineSlaKey(workspaceId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    const clean: Record<string, number> = {};
    for (const [stage, days] of Object.entries(parsed)) {
      const c = clampSlaDays(String(days));
      if (c) clean[stage] = c;
    }
    return clean;
  } catch {
    return {}; // corrupt/absent — fall back to the defaults
  }
}

/** Persist one workspace's SLA overrides. `null` tenant ⇒ no write. */
export function writeStoredSla(store: KeyValueStore, workspaceId: string | null, overrides: Record<string, number>): void {
  if (!workspaceId) return;
  try {
    store.setItem(pipelineSlaKey(workspaceId), JSON.stringify(overrides));
  } catch {
    /* storage unavailable — in-memory override still applies this session */
  }
}
