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
import { createHash } from "node:crypto";
import { DEFAULT_BRAND, sanitizeBrand, type BrandConfig } from "./brand-config";
import { LOGO_PATH, type LogoMime } from "./brand-logo";

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
  // The UPLOADED logo lives on the same row as the brand it belongs to (ADDITIVE
  // columns; docs/features/organization/README.md "Logo upload"), so it is scoped
  // exactly like brand_settings, with no new table for the tenancy manifest to learn.
  const have = new Set((d.prepare("PRAGMA table_info(brand_settings)").all() as { name: string }[]).map((c) => c.name));
  for (const [col, type] of [["logo_data", "BLOB"], ["logo_mime", "TEXT"], ["logo_hash", "TEXT"]] as const) {
    if (!have.has(col)) d.exec(`ALTER TABLE brand_settings ADD COLUMN ${col} ${type}`);
  }
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
  // A logo URL that is not the uploaded file's own serving URL (another link, or
  // none) orphans the stored bytes: drop them rather than keep a hidden copy.
  if (!isUploadedLogoUrl(clean.logoUrl)) {
    db().prepare("UPDATE brand_settings SET logo_data = NULL, logo_mime = NULL, logo_hash = NULL WHERE id = ?").run(ROW_ID);
  }
  return clean;
}

function isUploadedLogoUrl(url: string | null): boolean {
  return url !== null && (url === LOGO_PATH || url.startsWith(`${LOGO_PATH}?`));
}

export type StoredLogo = { bytes: Buffer; mime: LogoMime; hash: string };

/** The uploaded logo, or null. Only ever bytes that saveLogo's caller validated. */
export function getLogo(): StoredLogo | null {
  const row = db()
    .prepare("SELECT logo_data, logo_mime, logo_hash FROM brand_settings WHERE id = ?")
    .get(ROW_ID) as { logo_data: Buffer | null; logo_mime: string | null; logo_hash: string | null } | undefined;
  if (!row?.logo_data || !row.logo_hash) return null;
  if (row.logo_mime !== "image/png" && row.logo_mime !== "image/svg+xml") return null;
  return { bytes: row.logo_data, mime: row.logo_mime, hash: row.logo_hash };
}

/** Store validated bytes and point the brand's logoUrl at them (content-hash query,
 *  so a replaced logo busts every cache). Leaves the name and accent untouched. */
export function saveLogo(bytes: Uint8Array, mime: LogoMime): BrandConfig {
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  db()
    .prepare(
      `INSERT INTO brand_settings (id, logo_url, logo_data, logo_mime, logo_hash, updated_at)
       VALUES (@id, @logoUrl, @data, @mime, @hash, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         logo_url   = excluded.logo_url,
         logo_data  = excluded.logo_data,
         logo_mime  = excluded.logo_mime,
         logo_hash  = excluded.logo_hash,
         updated_at = excluded.updated_at`
    )
    .run({ id: ROW_ID, logoUrl: `${LOGO_PATH}?v=${hash}`, data: Buffer.from(bytes), mime, hash, updatedAt: new Date().toISOString() });
  return getBrand();
}

/** Remove the logo: the uploaded bytes and whatever URL the brand pointed at. */
export function clearLogo(): BrandConfig {
  db()
    .prepare("UPDATE brand_settings SET logo_url = NULL, logo_data = NULL, logo_mime = NULL, logo_hash = NULL, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), ROW_ID);
  return getBrand();
}
