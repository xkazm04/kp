import Database from "better-sqlite3";
import { openStore } from "./db-path";
import { randomId } from "./random-id";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { DEFAULT_TEMPLATE_BODY } from "@/app/features/shared/renderTemplate";

// Company JD templates — full CRUD. Isolated connection (job-ingest/offers/
// scheduler/decision-config pattern) so we don't touch the fork-active db.ts.
// A template is markdown with {{placeholders}}; see render-template.ts.
//
// Tenant tiers (E0 Phase 2 — the curated shared library): a template is either
// ORG-SHARED (workspace_id NULL — the curated company library every team reads, e.g.
// the seeded "Company standard") or TEAM-PRIVATE (workspace_id = a team's id — that
// team's own draft). Reads use the SHARED-corpus predicate (workspace_id IS NULL OR
// workspace_id = ?), exactly like the jobs corpus, so a team sees the org library plus
// its own private templates and never another team's. The `scope` field surfaces the tier.

export type TemplateScope = "org" | "team";
export type JdTemplate = {
  id: string;
  name: string;
  body: string;
  isDefault: boolean;
  scope: TemplateScope;
  createdAt: string;
  updatedAt: string;
};

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS jd_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      -- Tenant tier (P2): NULL = org-shared curated library; a team id = that team's
      -- private template. Nullable by design — the shared tier IS the null rows.
      workspace_id TEXT
    );
  `);
  // Migration for stores created before the tenant tier existed. Existing rows keep
  // workspace_id NULL, i.e. they join the ORG-SHARED library — matching the pre-tier
  // behavior where every template was visible to everyone.
  try {
    d.exec(`ALTER TABLE jd_templates ADD COLUMN workspace_id TEXT`);
  } catch {
    /* column already exists */
  }
  // Seed the standard ORG template once (workspace_id NULL). The count is over the ORG
  // tier ONLY, so the company baseline is still seeded into a DB that happens to hold
  // only team-private rows. INSERT OR IGNORE keeps it idempotent under a cold-start
  // race (two initializers both seeing an empty tier would otherwise collide on the PK).
  const orgCount = (d.prepare(`SELECT COUNT(*) AS n FROM jd_templates WHERE workspace_id IS NULL`).get() as { n: number }).n;
  if (orgCount === 0) {
    const now = new Date().toISOString();
    d.prepare(
      `INSERT OR IGNORE INTO jd_templates (id, name, body, is_default, created_at, updated_at, workspace_id) VALUES (?, ?, ?, 1, ?, ?, NULL)`
    ).run("tpl-standard", "Company standard", DEFAULT_TEMPLATE_BODY, now, now);
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
    scope: r.workspace_id == null ? "org" : "team",
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

/** How many templates one read returns, and the ceiling a caller may ask for.
 *
 *  The list had no bound at all: every row a team can see, each carrying a FULL markdown
 *  BODY, serialized into one response on every JD-builder mount and every open of the
 *  manager. A workspace that has been authoring for a year is not a hypothetical, and the
 *  cost is paid on a hot path by everyone. 200 is far above any real library and still a
 *  bound; a caller may raise it to {@link TEMPLATE_LIST_MAX_LIMIT} and no further, because
 *  an unclamped caller-supplied limit is just the missing bound with extra steps. */
export const TEMPLATE_LIST_DEFAULT_LIMIT = 200;
export const TEMPLATE_LIST_MAX_LIMIT = 500;

/** A bounded read. `truncated` is the honest half: a silently cut list tells the reader
 *  their library is smaller than it is, which is worse than a long one. */
export type TemplateList = { templates: JdTemplate[]; truncated: boolean };

/** Clamp a caller's limit into [1, MAX]; a missing or unusable value takes the default. */
function templateLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return TEMPLATE_LIST_DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit)), TEMPLATE_LIST_MAX_LIMIT);
}

/** The templates a team sees: the ORG-SHARED library (workspace_id NULL) plus its OWN
 *  private templates. Default leads, then org templates before team drafts, then name.
 *  Bounded — see TEMPLATE_LIST_DEFAULT_LIMIT. */
export function listTemplates(workspaceId: string = DEFAULT_WORKSPACE_ID, limit?: number): TemplateList {
  const n = templateLimit(limit);
  // One row past the bound, so "there are more" is ANSWERED rather than guessed from a
  // full page — a library holding exactly `n` templates is not truncated.
  const rows = db()
    .prepare(
      `SELECT * FROM jd_templates
       WHERE workspace_id IS NULL OR workspace_id = ?
       ORDER BY is_default DESC, (workspace_id IS NOT NULL) ASC, name ASC
       LIMIT ?`
    )
    .all(workspaceId, n + 1) as Record<string, unknown>[];
  return { templates: rows.slice(0, n).map(rowTo), truncated: rows.length > n };
}

/** One template by id — but only if it's ORG-SHARED or belongs to THIS team, so a
 *  team can't read another team's private template by guessing its id. */
export function getTemplate(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): JdTemplate | null {
  const r = db()
    .prepare(`SELECT * FROM jd_templates WHERE id = ? AND (workspace_id IS NULL OR workspace_id = ?)`)
    .get(id, workspaceId) as Record<string, unknown> | undefined;
  return r ? rowTo(r) : null;
}

/** Create a template. Default scope is TEAM-private (the recruiter's own draft); scope
 *  'org' publishes it to the shared company library (workspace_id NULL) — an
 *  org-affecting act. The route (POST /api/templates) is operator-gated today; a
 *  finer-grained "manage templates" capability is still future work once per-role
 *  RBAC lands. */
export function createTemplate(
  input: { name: string; body: string; scope?: TemplateScope },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): JdTemplate {
  const d = db();
  const id = newId();
  const now = new Date().toISOString();
  const ws = input.scope === "org" ? null : workspaceId;
  d.prepare(
    `INSERT INTO jd_templates (id, name, body, is_default, created_at, updated_at, workspace_id) VALUES (?, ?, ?, 0, ?, ?, ?)`
  ).run(id, input.name.trim() || "Untitled template", input.body, now, now, ws);
  return getTemplate(id, workspaceId)!;
}

/** Why a template write was refused. Machine reasons, not prose — the route turns
 *  each into a REFUSAL code the reader's own language resolves. */
export type TemplateWriteFailure = "notFound" | "conflict";

/** Why a delete was refused: the row isn't visible to this team, it is the last
 *  template the team can see, or it is the org default. */
export type TemplateDeleteFailure = "notFound" | "last" | "default";

/** The outcome of an edit. `template` on the failure branch is the row as it stands
 *  NOW, so a conflicted client can reload the winner instead of re-fetching. */
export type TemplateUpdateResult =
  | { ok: true; template: JdTemplate }
  | { ok: false; reason: TemplateWriteFailure; template?: JdTemplate };

/** Edit a template the team can see (its own draft, or the shared library), with an
 *  OPTIONAL compare-and-swap on `updatedAt`.
 *
 *  Template writes were last-writer-wins: two recruiters with the manager open both
 *  PUT their whole body and the slower click silently erased the other's. The
 *  precondition rides in the UPDATE's WHERE (the second of the two valid
 *  read→compute→write strategies in .claude/CLAUDE.md — this path does no slow work,
 *  so a compensating WHERE is cheaper than an IMMEDIATE transaction) and
 *  `res.changes === 0` is the conflict. `expectedUpdatedAt` omitted = the old
 *  unconditional behaviour, for callers that legitimately have no base stamp.
 *
 *  A team can't edit another team's private template (the same WHERE guard). */
export function editTemplate(
  id: string,
  input: { name?: string; body?: string; expectedUpdatedAt?: string },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): TemplateUpdateResult {
  const d = db();
  const cur = getTemplate(id, workspaceId);
  if (!cur) return { ok: false, reason: "notFound" };
  // The stamp IS the CAS token, so it must move on every accepted write: two edits
  // inside the same millisecond would otherwise leave the second one's base stamp
  // still valid and the third writer would clobber unnoticed.
  const nowIso = new Date().toISOString();
  const next = nowIso > cur.updatedAt ? nowIso : new Date(Date.parse(cur.updatedAt) + 1).toISOString();
  const res = d
    .prepare(
      `UPDATE jd_templates SET name = ?, body = ?, updated_at = ?
       WHERE id = ? AND (workspace_id IS NULL OR workspace_id = ?)` +
        (input.expectedUpdatedAt ? ` AND updated_at = ?` : ``)
    )
    .run(
      ...([
        input.name?.trim() || cur.name,
        input.body ?? cur.body,
        next,
        id,
        workspaceId,
        ...(input.expectedUpdatedAt ? [input.expectedUpdatedAt] : []),
      ] as string[])
    );
  if (res.changes === 0) return { ok: false, reason: "conflict", template: getTemplate(id, workspaceId) ?? undefined };
  return { ok: true, template: getTemplate(id, workspaceId)! };
}

/** Unconditional edit, kept as the thin legacy shape (`JdTemplate | null`) the
 *  cross-team isolation contract asserts on (app/_lib/templates-isolation.test.ts).
 *  New callers should use `editTemplate` and pass `expectedUpdatedAt`. */
export function updateTemplate(
  id: string,
  input: { name?: string; body?: string },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): JdTemplate | null {
  const r = editTemplate(id, input, workspaceId);
  return r.ok ? r.template : null;
}

/** Promote one ORG template to be the sole org default, clearing the flag on the other
 * org rows in a single transaction. The default is an ORG-WIDE baseline, so only a
 * shared-library template can hold it — a team-private draft can't become THE default.
 * Returns the promoted template, or null if the id isn't an org template this team sees. */
export function setDefaultTemplate(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): JdTemplate | null {
  const d = db();
  const cur = getTemplate(id, workspaceId);
  if (!cur || cur.scope !== "org") return null;
  const now = new Date().toISOString();
  const promote = d.transaction((tid: string) => {
    d.prepare(`UPDATE jd_templates SET is_default = 0, updated_at = ? WHERE is_default = 1 AND id != ? AND workspace_id IS NULL`).run(now, tid);
    d.prepare(`UPDATE jd_templates SET is_default = 1, updated_at = ? WHERE id = ? AND workspace_id IS NULL`).run(now, tid);
  });
  promote(id);
  return getTemplate(id, workspaceId);
}

/** Delete a template the team can see — but never the last one it can see, and never
 * the current default. Deleting the only is_default row would leave the library with
 * zero defaults: the seed only re-runs on an empty org tier, so the baseline would be
 * gone for good. To remove the default, promote another template first. */
export function deleteTemplate(
  id: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): { ok: true } | { ok: false; reason: TemplateDeleteFailure } {
  const d = db();
  // A refusal is a REASON, never English prose: the route maps each to a code and
  // the manager renders it in the reader's language (the reason strings used to be
  // forwarded as-is, so a Czech recruiter got an English sentence and no code).
  const cur = getTemplate(id, workspaceId);
  // Not visible to this team (gone, or another team's private draft) — said first,
  // so "the last template" can never be reported about a row that isn't there.
  if (!cur) return { ok: false, reason: "notFound" };
  // Count the team's VISIBLE set (org-shared + own) — deleting the last visible
  // template would leave the picker empty for this team.
  const count = (
    d.prepare(`SELECT COUNT(*) AS n FROM jd_templates WHERE workspace_id IS NULL OR workspace_id = ?`).get(workspaceId) as { n: number }
  ).n;
  if (count <= 1) return { ok: false, reason: "last" };
  if (cur.isDefault) return { ok: false, reason: "default" };
  d.prepare(`DELETE FROM jd_templates WHERE id = ? AND (workspace_id IS NULL OR workspace_id = ?)`).run(id, workspaceId);
  return { ok: true };
}
