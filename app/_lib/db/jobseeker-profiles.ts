import type { ProfilePayload } from "@/app/features/shared/profileTypes";
import { EMPTY_PREFERENCES, type JobseekerFeedAnchor, type JobseekerPreferences, type JobseekerProfile } from "../jobseeker/types";
import { mergePreferencePatch } from "../jobseeker/profile";
import { randomId } from "../random-id";
import { ensureDb, safeRowParse } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// The seeker's OWN record (app/_lib/jobseeker/types.ts): one row per (workspace, user)
// holding the CandidateProfileV2 the pipeline extracted from their CV, the preferences
// the studio elicited, and the polished CV.
//
// Tenancy: every statement — point reads by id included — binds `workspace_id = ?`
// (jobseeker-profiles-tenancy.test.ts). There is no public token on this surface and
// no by-id carve-out: a leaked profile id must not resolve another workspace's seeker.
//
// user_id is NULLABLE for the single-operator install that has no user rows yet, and
// SQLite treats NULL as distinct inside a UNIQUE constraint — so `ON CONFLICT
// (workspace_id, user_id)` would insert a second null-user row every call. The upsert
// is therefore a SELECT-then-INSERT/UPDATE inside an IMMEDIATE transaction (write lock
// at BEGIN, so two racing first saves serialize to one row).

type ProfileRow = {
  id: string;
  workspace_id: string;
  user_id: string | null;
  profile_json: string;
  preferences_json: string;
  cv_source_text: string | null;
  cv_polished_md: string | null;
  cv_hash: string | null;
  feed_seen_at: string | null;
  feed_seen_id: string | null;
  created_at: string;
  updated_at: string;
};

function fromRow(row: ProfileRow): JobseekerProfile {
  const profile = safeRowParse<ProfilePayload>(row.profile_json, "jobseekerProfile.profile", row.id);
  const preferences = safeRowParse<JobseekerPreferences>(row.preferences_json, "jobseekerProfile.preferences", row.id);
  return {
    id: row.id,
    // A row whose JSON no longer parses is still the seeker's row — surface it with an
    // empty payload rather than hiding it, so the studio can re-extract.
    profile: profile && typeof profile === "object" ? profile : ({} as ProfilePayload),
    preferences: preferences && typeof preferences === "object" ? { ...EMPTY_PREFERENCES, ...preferences } : EMPTY_PREFERENCES,
    cvSourceText: row.cv_source_text,
    cvPolishedMd: row.cv_polished_md,
    cvHash: row.cv_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The profile for a user of this workspace (`null` user = the workspace's own single
 *  seeker). `IS ?` rather than `= ?` because `NULL = NULL` is not true in SQL. */
export function getJobseekerProfile(userId: string | null, workspaceId: string = DEFAULT_WORKSPACE_ID): JobseekerProfile | null {
  const row = ensureDb()
    .prepare(`SELECT * FROM jobseeker_profiles WHERE user_id IS ? AND workspace_id = ?`)
    .get(userId, workspaceId) as ProfileRow | undefined;
  return row ? fromRow(row) : null;
}

/** The workspace's seeker profile when no user is in scope — the scan (a clock job or a
 *  background task has no session). One workspace is one seeker in the /me product; if
 *  several profile rows ever exist, the most recently updated one is the active seeker. */
export function getWorkspaceJobseekerProfile(workspaceId: string = DEFAULT_WORKSPACE_ID): JobseekerProfile | null {
  const row = ensureDb()
    .prepare(`SELECT * FROM jobseeker_profiles WHERE workspace_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1`)
    .get(workspaceId) as ProfileRow | undefined;
  return row ? fromRow(row) : null;
}

export function getJobseekerProfileById(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): JobseekerProfile | null {
  const row = ensureDb()
    .prepare(`SELECT * FROM jobseeker_profiles WHERE id = ? AND workspace_id = ?`)
    .get(id, workspaceId) as ProfileRow | undefined;
  return row ? fromRow(row) : null;
}

export type JobseekerProfileInput = {
  userId: string | null;
  profile: ProfilePayload;
  preferences: JobseekerPreferences;
  cvSourceText?: string | null;
  cvPolishedMd?: string | null;
  cvHash?: string | null;
};

/** Create or replace the (workspace, user) profile. The optional CV columns are
 *  `undefined` = keep what is stored, `null` = clear — a re-extraction that carries no
 *  polished CV must not wipe the one the studio already produced. */
export function upsertJobseekerProfile(input: JobseekerProfileInput, workspaceId: string = DEFAULT_WORKSPACE_ID): JobseekerProfile {
  const d = ensureDb();
  const now = new Date().toISOString();
  const run = d.transaction((): JobseekerProfile => {
    const existing = d
      .prepare(`SELECT * FROM jobseeker_profiles WHERE user_id IS ? AND workspace_id = ?`)
      .get(input.userId, workspaceId) as ProfileRow | undefined;
    if (existing) {
      d.prepare(
        `UPDATE jobseeker_profiles
         SET profile_json = ?, preferences_json = ?,
             cv_source_text = COALESCE(?, cv_source_text),
             cv_polished_md = COALESCE(?, cv_polished_md),
             cv_hash = COALESCE(?, cv_hash),
             updated_at = ?
         WHERE id = ? AND workspace_id = ?`
      ).run(
        JSON.stringify(input.profile),
        JSON.stringify(input.preferences),
        input.cvSourceText === undefined ? null : input.cvSourceText,
        input.cvPolishedMd === undefined ? null : input.cvPolishedMd,
        input.cvHash === undefined ? null : input.cvHash,
        now,
        existing.id,
        workspaceId
      );
      // COALESCE cannot express "set to NULL": an explicit null clears in a second step.
      const clears: string[] = [];
      if (input.cvSourceText === null) clears.push("cv_source_text = NULL");
      if (input.cvPolishedMd === null) clears.push("cv_polished_md = NULL");
      if (input.cvHash === null) clears.push("cv_hash = NULL");
      if (clears.length > 0) {
        d.prepare(`UPDATE jobseeker_profiles SET ${clears.join(", ")} WHERE id = ? AND workspace_id = ?`).run(existing.id, workspaceId);
      }
      return fromRow(
        d.prepare(`SELECT * FROM jobseeker_profiles WHERE id = ? AND workspace_id = ?`).get(existing.id, workspaceId) as ProfileRow
      );
    }
    const id = randomId("jsp");
    d.prepare(
      `INSERT INTO jobseeker_profiles
         (id, workspace_id, user_id, profile_json, preferences_json, cv_source_text, cv_polished_md, cv_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      workspaceId,
      input.userId,
      JSON.stringify(input.profile),
      JSON.stringify(input.preferences),
      input.cvSourceText ?? null,
      input.cvPolishedMd ?? null,
      input.cvHash ?? null,
      now,
      now
    );
    return fromRow(d.prepare(`SELECT * FROM jobseeker_profiles WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as ProfileRow);
  });
  return run.immediate();
}

// ── the feed's last-seen anchor ──────────────────────────────────────────────────────
//
// ONE durable anchor per profile (session-resume/last-seen-anchors), holding the
// ordering TUPLE the feed's keyset pager already uses — (first_seen_at, id). "New since
// your last visit" is DERIVED from it by one comparison (jobseeker-postings.ts
// countJobseekerPostingsNewSince); there is no maintained counter to drift.
//
// It NEVER moves backwards. That is a precondition in the UPDATE's WHERE rather than a
// read-then-write: two tabs closing at once, a beacon arriving after a later
// acknowledgement, a stale tuple from a page rendered minutes ago — each is answered by
// `res.changes === 0`, "nothing to do", instead of rewinding the seeker's feed.

/** The anchor tuple: the newest row the seeker demonstrably saw settled. */
export function getFeedAnchor(profileId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): JobseekerFeedAnchor | null {
  const row = ensureDb()
    .prepare(`SELECT feed_seen_at, feed_seen_id FROM jobseeker_profiles WHERE id = ? AND workspace_id = ?`)
    .get(profileId, workspaceId) as Pick<ProfileRow, "feed_seen_at" | "feed_seen_id"> | undefined;
  if (!row?.feed_seen_at || !row.feed_seen_id) return null;
  return { at: row.feed_seen_at, id: row.feed_seen_id };
}

/** Advance the anchor to `next`, or leave it exactly where it is when `next` is not
 *  strictly newer. Answers the anchor as it stands afterwards (never null after a
 *  successful first advance), so the caller reports the truth rather than what it asked
 *  for. Unknown / foreign profile id → null. */
export function advanceFeedAnchor(
  profileId: string,
  next: JobseekerFeedAnchor,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): JobseekerFeedAnchor | null {
  ensureDb()
    .prepare(
      `UPDATE jobseeker_profiles SET feed_seen_at = ?, feed_seen_id = ?
       WHERE id = ? AND workspace_id = ?
         AND (feed_seen_at IS NULL OR feed_seen_id IS NULL OR feed_seen_at < ? OR (feed_seen_at = ? AND feed_seen_id < ?))`
    )
    .run(next.at, next.id, profileId, workspaceId, next.at, next.at, next.id);
  return getFeedAnchor(profileId, workspaceId);
}

/** The studio produced (or re-produced) a polished CV. */
export function setPolishedCv(id: string, cvMarkdown: string, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const res = ensureDb()
    .prepare(`UPDATE jobseeker_profiles SET cv_polished_md = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
    .run(cvMarkdown, new Date().toISOString(), id, workspaceId);
  return res.changes > 0;
}

/** Merge a partial preference set over the stored one — what the cv_polish dialog does
 *  on close with the preferences it extracted. The merge rule is profile.ts's
 *  `mergePreferencePatch` (the ONE rule): `undefined` never overwrites, and an empty
 *  list never erases a stated one — a dialog that did not mention places hands back
 *  `[]`, which is "nothing said", not "no places". Read→merge→write, so IMMEDIATE: two
 *  dialogs closing at once must not lose one's fields. */
export function mergePreferences(
  id: string,
  partial: Partial<JobseekerPreferences>,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): JobseekerProfile | null {
  const d = ensureDb();
  const run = d.transaction((): JobseekerProfile | null => {
    const row = d
      .prepare(`SELECT * FROM jobseeker_profiles WHERE id = ? AND workspace_id = ?`)
      .get(id, workspaceId) as ProfileRow | undefined;
    if (!row) return null;
    const current = fromRow(row);
    const merged: JobseekerPreferences = mergePreferencePatch(current.preferences, partial);
    const now = new Date().toISOString();
    d.prepare(`UPDATE jobseeker_profiles SET preferences_json = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`).run(
      JSON.stringify(merged),
      now,
      id,
      workspaceId
    );
    return { ...current, preferences: merged, updatedAt: now };
  });
  return run.immediate();
}
