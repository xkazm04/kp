import { createHash } from "node:crypto";
import type { ProfilePayload } from "@/app/features/shared/profileTypes";
import { EMPTY_PREFERENCES, type CvDraftSource, type JobseekerCvListItem, type JobseekerCvSummary, type JobseekerProfile } from "../jobseeker/types";
import { randomId } from "../random-id";
import { ensureDb, safeRowParse } from "./core";
import { getJobseekerProfile, upsertJobseekerProfile } from "./jobseeker-profiles";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// Every CV the seeker has had read (docs/features/jobseeker/README.md, "Profile and CV
// studio"): the text extract-text produced, the profile draft that text became, and
// WHICH reader drafted it. Two things follow from keeping them:
//
//   - the same CV dropped again is recognised by its content hash and its stored draft
//     is applied — no second model call for a file already read;
//   - an earlier CV can be made the active one again ("Use this one").
//
// IDENTITY is the text, not the file: sha256 of the extracted text with every run of
// whitespace folded to one space and the ends trimmed (`cvContentHash`). A re-exported
// PDF whose line breaks moved is the same CV; a changed word is a new one.
//
// SCOPE is the seeker, not only the workspace: every statement binds `workspace_id = ?`
// (jobseeker-cvs-tenancy.test.ts) AND `user_id IS ?`, so one seat on a shared workspace
// can neither list nor use another seat's CVs. user_id is NULL for the single-operator
// install, and `IS` is how SQL compares a NULL.
//
// The upsert is SELECT-then-write inside an IMMEDIATE transaction for the same reason as
// jobseeker_profiles: a plain UNIQUE treats NULL users as distinct. core.ts backs it with
// a unique EXPRESSION index over IFNULL(user_id, ''), so a race that slipped past the
// lock would fail loudly rather than write a twin.

/** How many CVs one seeker keeps. The least recently used beyond it are dropped when a
 *  new one is recorded — a history, not an archive (each row carries the whole text). */
export const JOBSEEKER_CV_KEEP = 30;

/** The profile route's cap on the stored CV text, applied here too so a reused text
 *  is never longer than an imported one could be. */
export const MAX_CV_SOURCE_CHARS = 200_000;

type CvRow = {
  id: string;
  workspace_id: string;
  user_id: string | null;
  content_hash: string;
  file_name: string | null;
  byte_size: number | null;
  source_text: string;
  draft_json: string;
  draft_source: string | null;
  created_at: string;
  last_used_at: string;
};

type SummaryRow = Pick<CvRow, "id" | "content_hash" | "file_name" | "byte_size" | "draft_source" | "created_at" | "last_used_at">;

/** The whole stored CV, draft included — for applying it, never for a list. */
export type JobseekerCvRecord = JobseekerCvSummary & {
  contentHash: string;
  sourceText: string;
  draft: ProfilePayload;
};

/** The list's columns: metadata only, never the text or the draft. */
const SUMMARY_COLUMNS = "id, content_hash, file_name, byte_size, draft_source, created_at, last_used_at";

/** Whitespace-folded text: what the content hash is taken over. */
export function normaliseCvText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The CV's identity: sha256 (hex) of the whitespace-normalised extracted text. */
export function cvContentHash(text: string): string {
  return createHash("sha256").update(normaliseCvText(text), "utf8").digest("hex");
}

function sourceOf(raw: string | null): CvDraftSource | null {
  return raw === "llm" || raw === "deterministic" ? raw : null;
}

function summaryOf(row: SummaryRow): JobseekerCvSummary & { contentHash: string } {
  return {
    id: row.id,
    contentHash: row.content_hash,
    fileName: row.file_name,
    byteSize: row.byte_size,
    draftSource: sourceOf(row.draft_source),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

function recordOf(row: CvRow): JobseekerCvRecord {
  const draft = safeRowParse<ProfilePayload>(row.draft_json, "jobseekerCv.draft", row.id);
  return {
    ...summaryOf(row),
    sourceText: row.source_text,
    // A draft that no longer parses is still the seeker's CV: an empty payload lets the
    // caller notice and re-read rather than hiding the row.
    draft: draft && typeof draft === "object" ? draft : ({} as ProfilePayload),
  };
}

export type RecordJobseekerCvInput = {
  userId: string | null;
  sourceText: string;
  draft: ProfilePayload;
  draftSource: CvDraftSource | null;
  fileName?: string | null;
  byteSize?: number | null;
};

/** Record a CV that was just read. A text already on file (same hash) is UPDATED — the
 *  fresh draft replaces the stored one ("Read it again"), last_used_at moves — and never
 *  duplicated. Beyond JOBSEEKER_CV_KEEP the least recently used are dropped. */
export function recordJobseekerCv(input: RecordJobseekerCvInput, workspaceId: string = DEFAULT_WORKSPACE_ID): JobseekerCvRecord {
  const d = ensureDb();
  const sourceText = input.sourceText.slice(0, MAX_CV_SOURCE_CHARS);
  const hash = cvContentHash(sourceText);
  const now = new Date().toISOString();
  const draftJson = JSON.stringify(input.draft ?? {});
  const run = d.transaction((): JobseekerCvRecord => {
    const existing = d
      .prepare(`SELECT id FROM jobseeker_cvs WHERE workspace_id = ? AND user_id IS ? AND content_hash = ?`)
      .get(workspaceId, input.userId, hash) as { id: string } | undefined;
    let id: string;
    if (existing) {
      id = existing.id;
      d.prepare(
        `UPDATE jobseeker_cvs
         SET source_text = ?, draft_json = ?, draft_source = ?,
             file_name = COALESCE(?, file_name), byte_size = COALESCE(?, byte_size), last_used_at = ?
         WHERE id = ? AND workspace_id = ? AND user_id IS ?`
      ).run(sourceText, draftJson, input.draftSource, input.fileName ?? null, input.byteSize ?? null, now, id, workspaceId, input.userId);
    } else {
      id = randomId("jscv");
      d.prepare(
        `INSERT INTO jobseeker_cvs
           (id, workspace_id, user_id, content_hash, file_name, byte_size, source_text, draft_json, draft_source, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, workspaceId, input.userId, hash, input.fileName ?? null, input.byteSize ?? null, sourceText, draftJson, input.draftSource, now, now);
      // Keep the newest JOBSEEKER_CV_KEEP by use; the one just written is the newest.
      d.prepare(
        `DELETE FROM jobseeker_cvs
         WHERE workspace_id = ? AND user_id IS ?
           AND id NOT IN (
             SELECT id FROM jobseeker_cvs WHERE workspace_id = ? AND user_id IS ?
             ORDER BY last_used_at DESC, id DESC LIMIT ?
           )`
      ).run(workspaceId, input.userId, workspaceId, input.userId, JOBSEEKER_CV_KEEP);
    }
    return recordOf(d.prepare(`SELECT * FROM jobseeker_cvs WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as CvRow);
  });
  return run.immediate();
}

/** The seeker's stored CV whose text hashes like `text`, or null. */
export function findJobseekerCvByText(userId: string | null, text: string, workspaceId: string = DEFAULT_WORKSPACE_ID): JobseekerCvRecord | null {
  const row = ensureDb()
    .prepare(`SELECT * FROM jobseeker_cvs WHERE workspace_id = ? AND user_id IS ? AND content_hash = ?`)
    .get(workspaceId, userId, cvContentHash(text.slice(0, MAX_CV_SOURCE_CHARS))) as CvRow | undefined;
  return row ? recordOf(row) : null;
}

/** One of THIS seeker's CVs by id; another seeker's id (or another workspace's) is null. */
export function getJobseekerCv(id: string, userId: string | null, workspaceId: string = DEFAULT_WORKSPACE_ID): JobseekerCvRecord | null {
  const row = ensureDb()
    .prepare(`SELECT * FROM jobseeker_cvs WHERE id = ? AND workspace_id = ? AND user_id IS ?`)
    .get(id, workspaceId, userId) as CvRow | undefined;
  return row ? recordOf(row) : null;
}

/** The seeker's CVs, most recently used first — metadata only (no text, no draft). */
export function listJobseekerCvs(
  userId: string | null,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): (JobseekerCvSummary & { contentHash: string })[] {
  const rows = ensureDb()
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM jobseeker_cvs WHERE workspace_id = ? AND user_id IS ? ORDER BY last_used_at DESC, id DESC LIMIT ?`)
    .all(workspaceId, userId, JOBSEEKER_CV_KEEP) as SummaryRow[];
  return rows.map(summaryOf);
}

/** Make a stored CV the seeker's active one: the profile row takes its draft, its text
 *  and the text's hash exactly as the import's profile write does (PUT
 *  /api/jobseeker/profile: sha256 of the stored text, preferences kept), and the CV's
 *  last_used_at moves. The ONE path an import, a reuse and "Use this one" all take. */
export function makeJobseekerCvActive(
  cv: JobseekerCvRecord,
  userId: string | null,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): { profile: JobseekerProfile; cv: JobseekerCvRecord } {
  const existing = getJobseekerProfile(userId, workspaceId);
  const cvSourceText = cv.sourceText.slice(0, MAX_CV_SOURCE_CHARS);
  const profile = upsertJobseekerProfile(
    {
      userId,
      profile: cv.draft,
      preferences: existing?.preferences ?? EMPTY_PREFERENCES,
      cvSourceText,
      cvHash: createHash("sha256").update(cvSourceText, "utf8").digest("hex"),
    },
    workspaceId
  );
  touchJobseekerCv(cv.id, userId, workspaceId);
  return { profile, cv: getJobseekerCv(cv.id, userId, workspaceId) ?? cv };
}

/** The wire projection of a stored CV: the summary fields only — never the hash, the
 *  text or the draft — plus whether it is the active one. */
export function cvListItem(cv: JobseekerCvSummary, active: boolean): JobseekerCvListItem {
  return { id: cv.id, fileName: cv.fileName, byteSize: cv.byteSize, draftSource: cv.draftSource, createdAt: cv.createdAt, lastUsedAt: cv.lastUsedAt, active };
}

/** Whether `cv` is the one the profile is built from right now. */
export function isActiveCv(cv: { contentHash: string }, profile: Pick<JobseekerProfile, "cvSourceText"> | null): boolean {
  return !!profile?.cvSourceText && cvContentHash(profile.cvSourceText) === cv.contentHash;
}

/** The CV was made active again (a reuse or "Use this one"): move last_used_at. Answers
 *  whether a row of THIS seeker's moved. */
export function touchJobseekerCv(id: string, userId: string | null, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const res = ensureDb()
    .prepare(`UPDATE jobseeker_cvs SET last_used_at = ? WHERE id = ? AND workspace_id = ? AND user_id IS ?`)
    .run(new Date().toISOString(), id, workspaceId, userId);
  return res.changes > 0;
}
