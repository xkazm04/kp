import { randomId } from "../random-id";
import { ensureDb } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// The role posting rendered into a language other than the one it was written in
// (docs/features/jobs/README.md, "Opening a role"). Opening a role names the
// languages it is advertised in; the LLM layer renders the posting into each of
// them after the publish has committed, and each rendering is one row here.
//
// Why not a `job_postings` row: that table is the IMPORT corpus (ads a team pasted,
// fetched or seeded). Its `source` is a CHECK-pinned import vocabulary with no value
// meaning "we wrote this", and its dedupe UNIQUE is (content_hash, workspace_id) —
// so two roles whose postings render identically would collapse into one row and the
// second role would silently show the first one's advertisement.
//
// TENANCY. workspace_id is NOT NULL, every statement binds it LITERALLY (the source
// guard in job-translations-tenancy.test.ts greps these templates), and there is NO
// by-id carve-out and NO shared NULL tier — unlike `jobs`, where a NULL workspace
// means the cross-company reference corpus. A translation is written on ONE team's
// order and against ONE team's spend even when the role itself is a shared corpus
// row, so a leaked job id must never hand another team the body they paid to
// generate.

export type JobTranslation = {
  jobId: string;
  /** The app locale this body is written in. */
  lang: string;
  /** The locale the posting was rendered FROM — so the modal can say what a
   *  translation is a translation OF, and a re-render knows whether the source moved. */
  sourceLang: string;
  title: string;
  bodyMd: string;
  createdAt: string;
};

type Row = {
  job_id: string;
  lang: string;
  source_lang: string;
  title: string;
  body_md: string;
  created_at: string;
};

function fromRow(row: Row): JobTranslation {
  return {
    jobId: row.job_id,
    lang: row.lang,
    sourceLang: row.source_lang,
    title: row.title,
    bodyMd: row.body_md,
    createdAt: row.created_at,
  };
}

const COLUMNS = `job_id, lang, source_lang, title, body_md, created_at`;

/** Drop every rendering this team holds for one role. Called when the role's own
 *  fields are rewritten (a re-ingest of an edited JD, a restored revision): a German
 *  advertisement of the PREVIOUS text is not a translation of this one, and the
 *  posting tab's empty state with its "generate" button is the honest reading until
 *  someone renders it again. Returns how many languages were dropped. */
export function deleteJobTranslations(jobId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): number {
  return ensureDb().prepare(`DELETE FROM job_translations WHERE job_id = ? AND workspace_id = ?`).run(jobId, workspaceId).changes;
}

/** Every translation this team holds for one role, oldest language first. A role has
 *  at most one row per app locale, so this is bounded by the locale count and needs
 *  no paging. */
export function listJobTranslations(jobId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): JobTranslation[] {
  const rows = ensureDb()
    .prepare(`SELECT ${COLUMNS} FROM job_translations WHERE job_id = ? AND workspace_id = ? ORDER BY lang ASC`)
    .all(jobId, workspaceId) as Row[];
  return rows.map(fromRow);
}

/** One language's rendering, or null. Workspace-bound like every read here. */
export function getJobTranslation(
  jobId: string,
  lang: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): JobTranslation | null {
  const row = ensureDb()
    .prepare(`SELECT ${COLUMNS} FROM job_translations WHERE job_id = ? AND lang = ? AND workspace_id = ?`)
    .get(jobId, lang, workspaceId) as Row | undefined;
  return row ? fromRow(row) : null;
}

/** Which languages this team already holds for the role — the cheap read the posting
 *  modal's chip row needs to decide which chips get an empty state. */
export function listJobTranslationLangs(jobId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): string[] {
  const rows = ensureDb()
    .prepare(`SELECT lang FROM job_translations WHERE job_id = ? AND workspace_id = ? ORDER BY lang ASC`)
    .all(jobId, workspaceId) as { lang: string }[];
  return rows.map((r) => r.lang);
}

export type JobTranslationInput = {
  jobId: string;
  lang: string;
  sourceLang: string;
  title: string;
  bodyMd: string;
};

/** Write (or REPLACE) one language's rendering.
 *
 *  Upsert on (workspace_id, job_id, lang) rather than insert-or-skip: re-generating a
 *  language is a deliberate act — the recruiter edited the role, or the first render
 *  came back poor — and it must leave ONE current body, not a pile of drafts with no
 *  rule for which one the posting tab shows. The timestamp moves with it, so "when
 *  was this last rendered" stays true. */
export function saveJobTranslation(
  input: JobTranslationInput,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): JobTranslation {
  const createdAt = new Date().toISOString();
  ensureDb()
    .prepare(
      `INSERT INTO job_translations (id, workspace_id, job_id, lang, source_lang, title, body_md, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, job_id, lang)
       DO UPDATE SET source_lang = excluded.source_lang, title = excluded.title,
                     body_md = excluded.body_md, created_at = excluded.created_at`
    )
    .run(
      randomId("jtr"),
      workspaceId,
      input.jobId,
      input.lang,
      input.sourceLang,
      input.title.trim().slice(0, 300) || input.jobId,
      input.bodyMd,
      createdAt
    );
  return {
    jobId: input.jobId,
    lang: input.lang,
    sourceLang: input.sourceLang,
    title: input.title,
    bodyMd: input.bodyMd,
    createdAt,
  };
}
