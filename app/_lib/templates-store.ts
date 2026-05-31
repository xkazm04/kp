import path from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { DEFAULT_TEMPLATE_BODY } from "@/app/features/sub_library/render-template";

// Company JD templates — full CRUD. Isolated connection (job-ingest/offers/
// scheduler/decision-config pattern) so we don't touch the fork-active db.ts.
// A template is markdown with {{placeholders}}; see render-template.ts.

const DB_PATH = process.env.KP_DB_PATH ?? path.join(process.cwd(), "data", "kp.sqlite");

export type JdTemplate = { id: string; name: string; body: string; isDefault: boolean; createdAt: string; updatedAt: string };

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
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
  // Seed a standard template once.
  const count = (d.prepare(`SELECT COUNT(*) AS n FROM jd_templates`).get() as { n: number }).n;
  if (count === 0) {
    const now = new Date().toISOString();
    d.prepare(`INSERT INTO jd_templates (id, name, body, is_default, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`).run(
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

const newId = () => `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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

/** Delete a template — but never the last one (keep at least the standard). */
export function deleteTemplate(id: string): { ok: boolean; reason?: string } {
  const d = db();
  const count = (d.prepare(`SELECT COUNT(*) AS n FROM jd_templates`).get() as { n: number }).n;
  if (count <= 1) return { ok: false, reason: "Can't delete the last template." };
  d.prepare(`DELETE FROM jd_templates WHERE id = ?`).run(id);
  return { ok: true };
}
