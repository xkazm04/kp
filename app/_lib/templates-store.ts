import Database from "better-sqlite3";
import { DB_PATH, ensureDbDir } from "./db-path";
import { randomId } from "./random-id";
import { DEFAULT_TEMPLATE_BODY } from "@/app/features/sub_library/render-template";

// Company JD templates — full CRUD. Isolated connection (job-ingest/offers/
// scheduler/decision-config pattern) so we don't touch the fork-active db.ts.
// A template is markdown with {{placeholders}}; see render-template.ts.

export type JdTemplate = { id: string; name: string; body: string; isDefault: boolean; createdAt: string; updatedAt: string };

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  ensureDbDir();
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  d.exec(`
    CREATE TABLE IF NOT EXISTS jd_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  // Seed a standard template once. INSERT OR IGNORE keeps this idempotent: under
  // a multi-worker / serverless cold start two initializers can both observe an
  // empty table and both run the seed — the loser would otherwise throw UNIQUE
  // constraint failed on the fixed tpl-standard PK and 500 the first request.
  const count = (d.prepare(`SELECT COUNT(*) AS n FROM jd_templates`).get() as { n: number }).n;
  if (count === 0) {
    const now = new Date().toISOString();
    d.prepare(`INSERT OR IGNORE INTO jd_templates (id, name, body, is_default, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`).run(
      "tpl-standard",
      "Company standard",
      DEFAULT_TEMPLATE_BODY,
      now,
      now
    );
  }
  _db = d;
  return d;
}

const newId = () => randomId("tpl");

function rowTo(r: Record<string, unknown>): JdTemplate {
  return {
    id: r.id as string,
    name: r.name as string,
    body: r.body as string,
    isDefault: Boolean(r.is_default),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function listTemplates(): JdTemplate[] {
  return (db().prepare(`SELECT * FROM jd_templates ORDER BY is_default DESC, name ASC`).all() as Record<string, unknown>[]).map(rowTo);
}

export function getTemplate(id: string): JdTemplate | null {
  const r = db().prepare(`SELECT * FROM jd_templates WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? rowTo(r) : null;
}

export function createTemplate(input: { name: string; body: string }): JdTemplate {
  const d = db();
  const id = newId();
  const now = new Date().toISOString();
  d.prepare(`INSERT INTO jd_templates (id, name, body, is_default, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`).run(
    id,
    input.name.trim() || "Untitled template",
    input.body,
    now,
    now
  );
  return getTemplate(id)!;
}

export function updateTemplate(id: string, input: { name?: string; body?: string }): JdTemplate | null {
  const d = db();
  const cur = getTemplate(id);
  if (!cur) return null;
  d.prepare(`UPDATE jd_templates SET name = ?, body = ?, updated_at = ? WHERE id = ?`).run(
    input.name?.trim() || cur.name,
    input.body ?? cur.body,
    new Date().toISOString(),
    id
  );
  return getTemplate(id);
}

/** Promote one template to be the sole default, clearing the flag on every
 * other row in a single transaction. Returns the promoted template, or null
 * if the id doesn't exist. This is the only way to move the default, so the
 * "Company standard" baseline can be reassigned rather than lost. */
export function setDefaultTemplate(id: string): JdTemplate | null {
  const d = db();
  const cur = getTemplate(id);
  if (!cur) return null;
  const now = new Date().toISOString();
  const promote = d.transaction((tid: string) => {
    d.prepare(`UPDATE jd_templates SET is_default = 0, updated_at = ? WHERE is_default = 1 AND id != ?`).run(now, tid);
    d.prepare(`UPDATE jd_templates SET is_default = 1, updated_at = ? WHERE id = ?`).run(now, tid);
  });
  promote(id);
  return getTemplate(id);
}

/** Delete a template — but never the last one (keep at least the standard) and
 * never the current default. Deleting the only is_default row would leave the
 * library with zero defaults: the seed only re-runs on an empty table, so the
 * baseline would be gone for good. To remove the default, promote another
 * template first via setDefaultTemplate. */
export function deleteTemplate(id: string): { ok: boolean; reason?: string } {
  const d = db();
  const count = (d.prepare(`SELECT COUNT(*) AS n FROM jd_templates`).get() as { n: number }).n;
  if (count <= 1) return { ok: false, reason: "Can't delete the last template." };
  const cur = getTemplate(id);
  if (cur?.isDefault) return { ok: false, reason: "Can't delete the default template. Set another template as the default first." };
  d.prepare(`DELETE FROM jd_templates WHERE id = ?`).run(id);
  return { ok: true };
}
