// The Assignments ledger: one server row per case (challenge-r03 devcase-workspace/A).
//
// A SLICE of the dev-case store, not a section of devcase.ts: that module sits on the
// import graph of every studio route, and perf-budget.json caps each one. Only
// GET /api/devcase reads the ledger, so only it pays for it.
//
// TENANCY: devcase-tenancy.test.ts scans devcase.ts; this file's statements are pinned
// by devcase-ledger.test.ts instead, which asserts every dev table alias in them is
// filtered on its own workspace_id.
import { ensureDb, safeRowParse } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// Why the join lives here.
//
// The Cases table used to compute each row's stage, submission count and stall by
// joining three separately-bounded client lists: this case page (up to 500), the
// lifecycles (GET /api/devcase/lifecycle answers the 50 NEWEST only) and every posting
// with every submission and its parsed evaluation inlined. Past fifty lifecycles an
// older live assignment silently read the 'published'/'approved' fallback and lost its
// stall chip, and the stage/title/seniority filter only ever saw the loaded page. The
// join now happens here, once, over the whole workspace, and the filters run BEFORE
// the LIMIT. The row is a projection (the jobs/[id]/assignments precedent): the design
// JSON - need, analysis, role, case with its cover probes - is the detail reader's, read
// by id through getDevCase.

export type CaseLedgerFilters = {
  /** Matched against "<assignment title> <role title>", case-folded on both sides. */
  q?: string;
  stage?: string;
  seniority?: string;
  /** One role's assignments: dev_cases.job_id (the job page's assignments chip). */
  job?: string;
};

export type CaseLedgerRow = {
  id: string;
  title: string | null;
  roleTitle: string | null;
  seniority: string | null;
  status: string;
  createdAt: string;
  jobId: string | null;
  jobTitle: string | null;
  jdSlug: string | null;
  /** The newest lifecycle's stage, else 'published' when a posting exists, else
   *  'approved' - the fallback the table always showed, now decided in SQL. */
  stage: string;
  /** Submissions across every posting of the case. */
  submissionCount: number;
  lifecycleId: string | null;
  lifecycleCreatedAt: string | null;
  lifecycleUpdatedAt: string | null;
};

export type CaseLedgerFacets = { stages: string[]; seniorities: string[] };

/** ensureDb() plus the two things the ledger needs on the connection, applied once per
 *  db INSTANCE (the submissionStore shape, so a reset test connection re-applies them):
 *  an index on the join key nothing indexed (dev_lifecycle.case_id, scoped by tenant
 *  first), and a Unicode case fold. SQLite's lower() folds ASCII only, so a Czech
 *  title ("Šablona") would never match its own lowercase search; the client's old
 *  in-memory filter used toLocaleLowerCase, and the query must not answer less. */
function ledgerStore() {
  const db = ensureDb();
  const marked = db as unknown as { __kpDevCaseLedger?: boolean };
  if (!marked.__kpDevCaseLedger) {
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_dev_lifecycle_case ON dev_lifecycle (workspace_id, case_id)`);
    } catch {
      /* best-effort: a read-only connection cannot build the index, and the ledger read is still correct without it */
    }
    db.function("kp_fold", { deterministic: true }, (value: unknown) => String(value ?? "").toLocaleLowerCase());
    marked.__kpDevCaseLedger = true;
  }
  return db;
}

type CaseLedgerDbRow = {
  id: string;
  title: string | null;
  role_title: string | null;
  seniority: string | null;
  status: string;
  created_at: string;
  job_id: string | null;
  job_title: string | null;
  need_json: string | null;
  lifecycle_id: string | null;
  lifecycle_created_at: string | null;
  lifecycle_updated_at: string | null;
  stage: string;
  submission_count: number;
};

function rowToLedger(r: CaseLedgerDbRow): CaseLedgerRow {
  const need = safeRowParse<{ jdSlug?: unknown }>(r.need_json, "devCase.need", r.id);
  return {
    id: r.id,
    title: r.title,
    roleTitle: r.role_title,
    seniority: r.seniority,
    status: r.status,
    createdAt: r.created_at,
    jobId: r.job_id ?? null,
    jobTitle: r.job_title ?? null,
    jdSlug: typeof need?.jdSlug === "string" && need.jdSlug.trim() ? need.jdSlug.trim() : null,
    stage: r.stage,
    submissionCount: Number(r.submission_count ?? 0),
    lifecycleId: r.lifecycle_id ?? null,
    lifecycleCreatedAt: r.lifecycle_created_at ?? null,
    lifecycleUpdatedAt: r.lifecycle_updated_at ?? null,
  };
}

/** The ledger page: newest first, filtered before the limit. Pass `limit + 1` to learn
 *  whether a page was cut (the route does). Every dev table in the statement carries its
 *  own `workspace_id = ?`: a lifecycle or posting from another team that points at one
 *  of this team's case ids (a corrupt cross-link) must not paint its stage or count. */
export function listCaseLedger(
  limit: number,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  filters: CaseLedgerFilters = {}
): CaseLedgerRow[] {
  const db = ledgerStore();
  const q = (filters.q ?? "").trim().toLocaleLowerCase();
  const stage = (filters.stage ?? "").trim();
  const seniority = (filters.seniority ?? "").trim();
  const job = (filters.job ?? "").trim();
  const rows = db
    .prepare(
      `WITH latest AS (
         SELECT l.case_id, l.id AS lifecycle_id, l.stage, l.created_at, l.updated_at,
                ROW_NUMBER() OVER (PARTITION BY l.case_id ORDER BY l.created_at DESC, l.id DESC) AS rn
         FROM dev_lifecycle l WHERE l.workspace_id = ? AND l.case_id IS NOT NULL
       ),
       posted AS (
         SELECT p.case_id, COUNT(s.id) AS submission_count
         FROM dev_postings p LEFT JOIN dev_submissions s ON s.posting_id = p.id
         WHERE p.workspace_id = ? AND p.case_id IS NOT NULL GROUP BY p.case_id
       ),
       ledger AS (
         SELECT c.id, c.title, c.role_title, c.seniority, c.status, c.created_at, c.job_id, c.need_json,
                j.title AS job_title, lc.lifecycle_id, lc.created_at AS lifecycle_created_at,
                lc.updated_at AS lifecycle_updated_at,
                COALESCE(lc.stage, CASE WHEN pc.case_id IS NOT NULL THEN 'published' ELSE 'approved' END) AS stage,
                COALESCE(pc.submission_count, 0) AS submission_count
         FROM dev_cases c
         LEFT JOIN jobs j ON j.id = c.job_id
         LEFT JOIN latest lc ON lc.case_id = c.id AND lc.rn = 1
         LEFT JOIN posted pc ON pc.case_id = c.id
         WHERE c.workspace_id = ?
       )
       SELECT * FROM ledger
       WHERE (? = '' OR stage = ?)
         AND (? = '' OR seniority = ?)
         AND (? = '' OR job_id = ?)
         AND (? = '' OR instr(kp_fold(COALESCE(title, '') || ' ' || COALESCE(role_title, '')), ?) > 0)
       ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(workspaceId, workspaceId, workspaceId, stage, stage, seniority, seniority, job, job, q, q, limit) as CaseLedgerDbRow[];
  return rows.map(rowToLedger);
}

/** The filter vocabulary for the WHOLE workspace. The table's stage and seniority
 *  pickers used to list only the values on the loaded page - and once the page is the
 *  filtered answer, that would collapse the picker to the one value already chosen. */
export function listCaseLedgerFacets(workspaceId: string = DEFAULT_WORKSPACE_ID): CaseLedgerFacets {
  const db = ledgerStore();
  const stages = db
    .prepare(
      `WITH latest AS (
         SELECT l.case_id, l.stage,
                ROW_NUMBER() OVER (PARTITION BY l.case_id ORDER BY l.created_at DESC, l.id DESC) AS rn
         FROM dev_lifecycle l WHERE l.workspace_id = ? AND l.case_id IS NOT NULL
       )
       SELECT DISTINCT COALESCE(lc.stage, CASE WHEN EXISTS (
                SELECT 1 FROM dev_postings p WHERE p.workspace_id = ? AND p.case_id = c.id
              ) THEN 'published' ELSE 'approved' END) AS stage
       FROM dev_cases c LEFT JOIN latest lc ON lc.case_id = c.id AND lc.rn = 1
       WHERE c.workspace_id = ? ORDER BY stage`
    )
    .all(workspaceId, workspaceId, workspaceId) as Array<{ stage: string }>;
  const seniorities = db
    .prepare(
      `SELECT DISTINCT c.seniority FROM dev_cases c
       WHERE c.workspace_id = ? AND c.seniority IS NOT NULL AND c.seniority <> '' ORDER BY c.seniority`
    )
    .all(workspaceId) as Array<{ seniority: string }>;
  return { stages: stages.map((r) => r.stage), seniorities: seniorities.map((r) => r.seniority) };
}
