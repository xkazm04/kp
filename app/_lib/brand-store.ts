// White-label brand persistence (E3). One row per workspace — single-workspace
// today (id='workspace'), exactly like billing_state; a workspace_id column and
// per-tenant scoping get added when E0 (tenancy) lands. Isolated-connection store
// (openStore) with a lazily-created table, matching the other *-store.ts modules.
//
// NOTE for the E0 migration: this lazy CREATE adds one more table to the set the
// boot tenancy guard must learn to count (org plan §2.3) — scope it by workspace_id
// then, like the reference stores.

import type { Database } from "better-sqlite3";
import { openStore } from "./db-path";
import { DEFAULT_BRAND, sanitizeBrand, type BrandConfig } from "./brand-config";

const ROW_ID = "workspace";

let _db: Database | null = null;
function db(): Database {
  if (_db) return _db;
  const d = openStore();
  d.exec(
    `CREATE TABLE IF NOT EXISTS brand_settings (
       id           TEXT PRIMARY KEY,
       display_name TEXT,
       accent_color TEXT,
       logo_url     TEXT,
       updated_at   TEXT NOT NULL
     )`
  );
  _db = d;
  return d;
}

type BrandRow = { display_name: string | null; accent_color: string | null; logo_url: string | null };

/** The workspace's stored brand, or product defaults when unset.
 *
 *  RE-VALIDATED ON READ, not only on write. `sanitizeBrand` is the invariant the
 *  rest of the app leans on — BrandStyle.tsx injects `accentColor` straight into a
 *  <style> and calls that safe because "the color is strictly hex-validated at the
 *  store boundary" — but saveBrand only enforces it on the way IN. A row already at
 *  rest was handed back verbatim, so any value that predates a rule kept being served
 *  forever: an accent saved before the WCAG legibility gate landed (e.g. "#ffff88",
 *  the exact case brand-config.test.ts pins as refused) still re-skinned every button
 *  and focus ring, app-wide AND on the candidate-facing offer/apply/schedule pages,
 *  because nothing re-checks a stored value. Sanitizing here makes the guarantee hold
 *  for every reader; it is idempotent for anything saveBrand itself wrote. */
export function getBrand(): BrandConfig {
  const row = db()
    .prepare("SELECT display_name, accent_color, logo_url FROM brand_settings WHERE id = ?")
    .get(ROW_ID) as BrandRow | undefined;
  if (!row) return DEFAULT_BRAND;
  return sanitizeBrand({ displayName: row.display_name, accentColor: row.accent_color, logoUrl: row.logo_url });
}

/** Validate (app/_lib/brand-config.ts) then upsert; returns the stored (cleaned) value. */
export function saveBrand(input: unknown): BrandConfig {
  const clean = sanitizeBrand(input);
  db()
    .prepare(
      `INSERT INTO brand_settings (id, display_name, accent_color, logo_url, updated_at)
       VALUES (@id, @displayName, @accentColor, @logoUrl, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name,
         accent_color = excluded.accent_color,
         logo_url     = excluded.logo_url,
         updated_at   = excluded.updated_at`
    )
    .run({
      id: ROW_ID,
      displayName: clean.displayName,
      accentColor: clean.accentColor,
      logoUrl: clean.logoUrl,
      updatedAt: new Date().toISOString(),
    });
  return clean;
}
