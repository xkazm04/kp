import Database from "better-sqlite3";
import { openStore } from "./db-path";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { getPipelineEntry } from "./db/pipeline";
import { jdLastEditedAt } from "./db/jobs";
import { jdSlugOfJobId } from "./jd-limits";
import { chunk, SQL_IN_CHUNK } from "./entries-param";
import type { Scorecard } from "./interview-scorecard";

// Persisted store for interview-prep artifacts — one timed interview plan per
// pipeline entry (candidate × role), generated on accepted screening and opened
// from the Schedule tab. Uses its OWN better-sqlite3 connection to the shared DB
// file (WAL), mirroring group-eval.ts / dev-control.ts so it never touches the
// fork-churned db.ts.

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  // Isolated connection on the shared kp.sqlite file (WAL + busy_timeout=5000):
  // shares kp.sqlite with db.ts and the reminder heartbeat, so a concurrent writer
  // waits briefly rather than instantly throwing SQLITE_BUSY (mirrors db.ts).
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS interview_preps (
      entry_id TEXT PRIMARY KEY,
      candidate_label TEXT,
      job_title TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT 'workspace'
    );
  `);
  // Tenancy scoping (E0 Phase 1): workspace_id on a pre-existing table (isolated store).
  try {
    d.exec(`ALTER TABLE interview_preps ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace'`);
  } catch {
    /* column already exists — idempotent */
  }
  _db = d;
  return d;
}

export type InterviewPrep = {
  entryId: string;
  candidateLabel: string | null;
  jobTitle: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

/** Full-payload upsert of a prep artifact.
 *
 *  `created_at` is the GENERATION stamp — "when this plan was built" — and it is
 *  what `isPrepStale` compares against the linked JD's last edit and what the
 *  schedule card / modal render as "generated NN ago". So it moves ONLY on a real
 *  (re)generation: pass `{ regenerated: true }` (runInterviewPrep does).
 *
 *  Every OTHER caller is a read-merge-write of the SAME plan — the interview-kit
 *  import (POST) and the weave/unweave (PATCH) both round-trip the payload through
 *  here — and bumping the stamp there silently marked a stale pack fresh: a JD
 *  edited after generation raised the "JD edited since" chip, and importing a
 *  question afterwards pushed created_at past the edit, so the chip vanished while
 *  the chronology still described the OLD role. Same rule
 *  saveInterviewPrepProgress already holds for the checklist/notes write. */
export function saveInterviewPrep(
  entryId: string,
  candidateLabel: string | null,
  jobTitle: string | null,
  payload: Record<string, unknown>,
  opts: { regenerated?: boolean } = {}
): void {
  // Tenant (P1): a prep inherits its pipeline entry's workspace (by-id read; guarded so
  // an isolated store whose connection lacks pipeline_entries falls back to the default).
  // Every OTHER interview_preps op is keyed by the globally-unique entry_id, so a by-id
  // flip can't cross tenants — the stamp here is what makes a future enumeration scopable.
  let workspaceId = DEFAULT_WORKSPACE_ID;
  try {
    const ws = db().prepare(`SELECT workspace_id FROM pipeline_entries WHERE id = ?`).get(entryId) as { workspace_id?: string } | undefined;
    workspaceId = ws?.workspace_id ?? DEFAULT_WORKSPACE_ID;
  } catch {
    /* pipeline_entries absent on this connection — keep the default workspace */
  }
  db()
    .prepare(
      `INSERT INTO interview_preps (entry_id, candidate_label, job_title, payload_json, created_at, workspace_id)
       VALUES (@entry_id, @candidate_label, @job_title, @payload_json, @created_at, @workspace_id)
       ON CONFLICT(entry_id) DO UPDATE SET
         candidate_label = excluded.candidate_label,
         job_title = excluded.job_title,
         payload_json = excluded.payload_json,
         created_at = CASE WHEN @regenerated = 1 THEN excluded.created_at ELSE interview_preps.created_at END`
    )
    .run({
      entry_id: entryId,
      candidate_label: candidateLabel,
      job_title: jobTitle,
      payload_json: JSON.stringify(payload),
      created_at: new Date().toISOString(),
      workspace_id: workspaceId,
      regenerated: opts.regenerated === true ? 1 : 0,
    });
}

// The interviewer's working state on a prep guide (PREP2): which coverage items
// are ticked + free-text notes (the verbatim quotes the rubric asks for). Stored
// UNDER a reserved `userProgress` key inside the artifact payload so it rides the
// same row without a schema change and the generated plan (scenario/chronology/…)
// stays untouched.
// `interviewer` (PREP5) is the assigned human owner of the round — distinct from
// the checklist/notes, kept at the TOP of the payload (not inside userProgress) so
// listPreparedEntries can surface it on the schedule card without parsing progress.
export type InterviewPrepProgress = { checked?: Record<string, boolean>; notes?: string; interviewer?: string };

/** Merge the interviewer's checklist + notes (+ assigned interviewer, PREP5) into
 *  an EXISTING prep artifact, preserving the generated plan AND `created_at` (a
 *  progress save is not a regeneration — `listPreparedEntries`/the "generated NN
 *  ago" stamp must not move). ONE write path for all human prep inputs, so they
 *  can't race each other. Returns false when there's no artifact to attach to. */
export function saveInterviewPrepProgress(entryId: string, progress: InterviewPrepProgress): boolean {
  // Atomic read-merge-write: this and saveHumanScorecard mutate disjoint keys of the
  // same payload_json. A BEGIN IMMEDIATE transaction (re-reading inside) takes the write
  // lock before the read, so a concurrent scorecard write on another connection/process
  // (kp's fork-churned model) can't read-then-clobber — last-write-wins can't drop the
  // other human input.
  return db().transaction((): boolean => {
    const existing = getInterviewPrep(entryId);
    if (!existing) return false;
    const { interviewer, ...checklist } = progress;
    const payload: Record<string, unknown> = { ...existing.payload, userProgress: checklist };
    // Top-level interviewer; an empty assignment clears it (undefined drops on stringify).
    payload.interviewer = interviewer && interviewer.trim() ? interviewer.trim() : undefined;
    const res = db()
      .prepare(`UPDATE interview_preps SET payload_json = ? WHERE entry_id = ?`)
      .run(JSON.stringify(payload), entryId);
    return res.changes > 0;
  }).immediate();
}

/** Persist the recruiter's human-filled scorecard (PREP1) onto an EXISTING prep
 *  artifact, under a reserved `humanScorecard` key in the payload — same seam as
 *  saveInterviewPrepProgress, so no schema change and the generated plan +
 *  created_at are untouched. Always tagged source:"human". Returns false when
 *  there's no prep to attach to (the scorecard is filled from the prep modal, so
 *  one always exists in practice). */
export function saveHumanScorecard(entryId: string, scorecard: Scorecard): boolean {
  // Atomic read-merge-write — see saveInterviewPrepProgress. The progress PUT and this
  // scorecard POST share the row but touch disjoint keys; the IMMEDIATE transaction
  // makes each merge serialize so neither clobbers the other's just-saved input.
  return db().transaction((): boolean => {
    const existing = getInterviewPrep(entryId);
    if (!existing) return false;
    const payload = { ...existing.payload, humanScorecard: { ...scorecard, source: "human" as const } };
    const res = db()
      .prepare(`UPDATE interview_preps SET payload_json = ? WHERE entry_id = ?`)
      .run(JSON.stringify(payload), entryId);
    return res.changes > 0;
  }).immediate();
}

/** The human scorecard saved on an entry's prep artifact, if any (PREP1). Read by
 *  surfaces that show interview results so a human-led round isn't invisible. */
export function getHumanScorecard(entryId: string): Scorecard | null {
  const prep = getInterviewPrep(entryId);
  const sc = (prep?.payload as { humanScorecard?: Scorecard } | undefined)?.humanScorecard;
  return sc ?? null;
}

// ── Direction 1: prep-pack staleness ────────────────────────────────────────
// The prep artifact is generated ONCE (on accepted screening) and regenerated
// only on an explicit click. If the linked JD's body is edited afterwards, the
// pack silently describes the OLD role — the identical problem the analyses
// roster solved with a "JD edited since" chip (jdLastEditedAt over jd_revisions).
// We derive the same honest fact for a prep by joining the entry to its JD via
// the load-bearing jd-<slug> identity, then comparing the prep's createdAt to the
// JD's last content edit. Nothing here auto-regenerates: it only surfaces the fact.

/** The linked JD's last CONTENT-edit time for a prep entry, or null when the entry
 *  has no JD-backed job (a seeded/ingested corpus job, or no job at all — so no
 *  chip). Read-only join: entry → jobId → jd-<slug> identity (jdSlugOfJobId) →
 *  jdLastEditedAt, all workspace-scoped. Mirrors the analyses roster's jdEditedAt. */
export function prepJdEditedAt(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): string | null {
  const entry = getPipelineEntry(entryId, workspaceId);
  const slug = jdSlugOfJobId(entry?.jobId);
  return slug ? jdLastEditedAt(slug, workspaceId) : null;
}

/** Is a prep (re)generated at `createdAt` stale against its linked JD's last edit?
 *  True ONLY when the JD was edited strictly AFTER the prep was generated — an
 *  ISO-8601 UTC string compare, exactly like the analyses roster. A never-edited or
 *  non-JD-backed job (jdEditedAt null) is never stale. Pure so the modal + the
 *  schedule card can share the one rule; the modal inlines the same compare on the
 *  client (this module carries a better-sqlite3 import and can't cross the boundary). */
export function isPrepStale(createdAt: string, jdEditedAt: string | null): boolean {
  return jdEditedAt != null && createdAt < jdEditedAt;
}

export function getInterviewPrep(entryId: string): InterviewPrep | null {
  const row = db()
    .prepare(`SELECT entry_id, candidate_label, job_title, payload_json, created_at FROM interview_preps WHERE entry_id = ?`)
    .get(entryId) as { entry_id: string; candidate_label: string | null; job_title: string | null; payload_json: string; created_at: string } | undefined;
  if (!row) return null;
  try {
    return { entryId: row.entry_id, candidateLabel: row.candidate_label, jobTitle: row.job_title, payload: JSON.parse(row.payload_json), createdAt: row.created_at };
  } catch {
    return null;
  }
}

/** Which of the given entry ids already have a prep artifact — `createdAt` plus the
 *  assigned `interviewer` (PREP5), so the schedule card shows who owns each round at
 *  a glance, and whether a recruiter-filled `humanScorecard` is saved, so the
 *  Schedule tab can keep a human-led round (no voice transcript) visible after its
 *  verdict gates the entry (interview-prep-rubric #2). The IN query is chunked under
 *  the SQLite variable limit so a wide board never trips SQLITE_MAX_VARIABLE_NUMBER
 *  (idea-191ccc0c). */
export function listPreparedEntries(
  entryIds: string[],
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Record<string, { createdAt: string; interviewer: string | null; hasHumanScorecard: boolean; stale: boolean }> {
  if (entryIds.length === 0) return {};
  const out: Record<string, { createdAt: string; interviewer: string | null; hasHumanScorecard: boolean; stale: boolean }> = {};
  for (const ids of chunk(entryIds, SQL_IN_CHUNK)) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = db()
      .prepare(`SELECT entry_id, payload_json, created_at FROM interview_preps WHERE entry_id IN (${placeholders})`)
      .all(...ids) as { entry_id: string; payload_json: string; created_at: string }[];
    for (const r of rows) {
      let interviewer: string | null = null;
      let hasHumanScorecard = false;
      try {
        const p = JSON.parse(r.payload_json) as { interviewer?: unknown; humanScorecard?: unknown };
        if (typeof p.interviewer === "string" && p.interviewer.trim()) interviewer = p.interviewer.trim();
        hasHumanScorecard = Boolean(p.humanScorecard);
      } catch {
        /* corrupt payload — no interviewer/scorecard flag, createdAt still useful */
      }
      // Direction 1 — flag the card when its JD changed after the pack was built, so
      // the schedule tab carries the same honest "regenerate this" cue the modal does.
      const stale = isPrepStale(r.created_at, prepJdEditedAt(r.entry_id, workspaceId));
      out[r.entry_id] = { createdAt: r.created_at, interviewer, hasHumanScorecard, stale };
    }
  }
  return out;
}
