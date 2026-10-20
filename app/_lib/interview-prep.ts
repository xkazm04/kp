import Database from "better-sqlite3";
import { openStore } from "./db-path";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { getPipelineEntry } from "./db/pipeline";
import { jdLastEditedAt } from "./db/jobs";
import { jdSlugOfJobId } from "./jd-limits";
import { chunk, SQL_IN_CHUNK } from "./entries-param";
import type { Scorecard } from "./interview-scorecard";
import type { KitOverlay } from "./interview-kit-types";
import {
  headlineScorecard,
  readHumanScorecards,
  upsertHumanScorecard,
  type HumanScorecardKey,
  type HumanScorecardRecord,
} from "./human-scorecard-set";

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
    const existing = readPrepRow(entryId);
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

/** Persist one interviewer's human-filled scorecard (PREP1) onto an EXISTING prep
 *  artifact — same seam as saveInterviewPrepProgress, so no schema change and the
 *  generated plan + created_at are untouched. Always tagged source:"human".
 *
 *  Filed under its (author, stage) key in the `humanScorecards` list
 *  (human-scorecard-set.ts, r09 schedule-interview-prep/A): a save replaces only the
 *  caller's own record for that round, so a colleague's save or a later round never
 *  erases an earlier record. `humanScorecard` is rewritten in the same UPDATE as the
 *  HEADLINE MIRROR (the latest save), which is the one key every pre-list reader knows
 *  (getHumanScorecard, the candidate drawer, the compare grid, the Schedule card flag).
 *
 *  "missing" when there is no prep to attach to; "full" when the list holds
 *  MAX_HUMAN_SCORECARDS records and this key is new — refused, never made room for. */
export function fileHumanScorecard(entryId: string, scorecard: Scorecard, key: HumanScorecardKey): "saved" | "missing" | "full" {
  // Atomic read-merge-write — see saveInterviewPrepProgress. The progress PUT and this
  // scorecard POST share the row but touch disjoint keys; the IMMEDIATE transaction
  // takes the write lock BEFORE the read, so two interviewers saving at once serialize
  // and each upsert sees the other's record. No await inside.
  return db().transaction((): "saved" | "missing" | "full" => {
    const existing = readPrepRow(entryId);
    if (!existing) return "missing";
    const record: HumanScorecardRecord = { ...scorecard, source: "human", ...key, savedAt: new Date().toISOString() };
    const next = upsertHumanScorecard(readHumanScorecards(existing.payload), record);
    if (!next) return "full";
    const payload = { ...existing.payload, humanScorecards: next, humanScorecard: headlineScorecard(next) ?? record };
    const res = db()
      .prepare(`UPDATE interview_preps SET payload_json = ? WHERE entry_id = ?`)
      .run(JSON.stringify(payload), entryId);
    return res.changes > 0 ? "saved" : "missing";
  }).immediate();
}

// ── Staged regeneration (r09 schedule-interview-prep/B) ──────────────────────
// A modal Regenerate parks its generator keys under `payload.pendingPlan` until the
// interviewer accepts or discards the diff. Inert for every other reader; an UNSTAGED
// regeneration drops it (mergeRegeneratedPrep).

/** The INVERTED regeneration merge: keep every previous key, overwrite only the
 *  generator's (the old 3-key allowlist silently destroyed any other human key).
 *  `pendingPlan` is the one key NOT carried: a committed plan supersedes a staged one.
 *  Lives here (re-exported by interview-prep-run.ts) so accept applies the same rule. */
export function mergeRegeneratedPrep(
  prevPayload: Record<string, unknown> | null | undefined,
  generated: Record<string, unknown>
): Record<string, unknown> {
  const carried: Record<string, unknown> = { ...(prevPayload ?? {}) };
  delete carried.pendingPlan;
  return { ...carried, ...generated };
}

/** A pack with a committed run-of-show; an erased (`{}`) pack has none. */
export function hasCommittedPlan(payload: Record<string, unknown> | null | undefined): boolean {
  const c = payload?.chronology;
  return Array.isArray(c) && c.length > 0;
}

/** Stage `pending` on a pack with a committed plan; plan and created_at untouched.
 *  Lock-first (`.immediate()`, no await). null = nothing to stage against. */
export function stageInterviewPrepPlan(entryId: string, pending: Record<string, unknown>): Record<string, unknown> | null {
  return db().transaction((): Record<string, unknown> | null => {
    const existing = readPrepRow(entryId);
    if (!existing || !hasCommittedPlan(existing.payload)) return null;
    const payload = { ...existing.payload, pendingPlan: pending };
    const res = db()
      .prepare(`UPDATE interview_preps SET payload_json = ? WHERE entry_id = ?`)
      .run(JSON.stringify(payload), entryId);
    return res.changes > 0 ? payload : null;
  }).immediate();
}

export type PendingPlanDecision = "accept" | "discard";
export type PendingPlanOutcome = { applied: false } | { applied: true; payload: Record<string, unknown>; createdAt: string };

/** Accept or discard the staged plan. Idempotent: no pending plan -> `{ applied: false }`,
 *  nothing written. Accept merges it in and moves created_at in the SAME UPDATE
 *  (accepting IS the regeneration); discard leaves created_at. The re-read inside the
 *  IMMEDIATE lock makes two racing decisions apply once. */
export function resolvePendingPlan(entryId: string, decision: PendingPlanDecision): PendingPlanOutcome {
  return db().transaction((): PendingPlanOutcome => {
    const existing = readPrepRow(entryId);
    const pending = existing?.payload.pendingPlan;
    if (!existing || pending === undefined) return { applied: false };
    let payload: Record<string, unknown>;
    let createdAt = existing.createdAt;
    if (decision === "accept") {
      // A malformed candidate is never swapped in.
      if (!pending || typeof pending !== "object" || !hasCommittedPlan(pending as Record<string, unknown>)) return { applied: false };
      payload = mergeRegeneratedPrep(existing.payload, pending as Record<string, unknown>);
      createdAt = new Date().toISOString();
    } else {
      payload = { ...existing.payload };
      delete payload.pendingPlan;
    }
    const res = db()
      .prepare(`UPDATE interview_preps SET payload_json = ?, created_at = ? WHERE entry_id = ?`)
      .run(JSON.stringify(payload), createdAt, entryId);
    return res.changes > 0 ? { applied: true, payload, createdAt } : { applied: false };
  }).immediate();
}

/** The pre-list signature, kept for its callers (the drawer's consent test among
 *  them): files the card under `key` — by default the identity-less slot of an
 *  unknown round, which is what open mode writes — and answers whether it was stored. */
export function saveHumanScorecard(
  entryId: string,
  scorecard: Scorecard,
  key: HumanScorecardKey = { author: null, authorLabel: null, stage: null }
): boolean {
  return fileHumanScorecard(entryId, scorecard, key) === "saved";
}

/** Persist the recruiter's per-candidate edits to the job interview kit (spark
 *  interview-kit-template, WP-C) under the reserved `kitOverlay` payload key. A
 *  HUMAN-owned key: the generator never writes it, so mergeRegeneratedPrep carries it
 *  across a Regenerate, and the agenda reads it at connect (interview-agenda.ts).
 *
 *  The overlay is REPLACED whole — the modal always sends its complete state — but the
 *  write is still an atomic read-merge-write for the same reason as its two siblings
 *  above: the checklist PUT and the scorecard POST mutate other keys of this one
 *  payload, and a plain read-then-write here could put back a copy of those keys from
 *  before their own save. The caller has already validated `overlay`
 *  (interview-prep-kit.ts parseKitOverlayWrite). Returns false when there is no pack. */
export function saveInterviewPrepKitOverlay(entryId: string, overlay: KitOverlay): boolean {
  return db().transaction((): boolean => {
    const existing = readPrepRow(entryId);
    if (!existing) return false;
    const payload = { ...existing.payload, kitOverlay: overlay };
    const res = db()
      .prepare(`UPDATE interview_preps SET payload_json = ? WHERE entry_id = ?`)
      .run(JSON.stringify(payload), entryId);
    return res.changes > 0;
  }).immediate();
}

/** The HEADLINE human scorecard on an entry's prep artifact, if any (PREP1): the
 *  latest save across every interviewer and round — the `humanScorecard` mirror. Read
 *  by single-card surfaces that show interview results so a human-led round isn't
 *  invisible; the whole panel is `getHumanScorecards`. */
export function getHumanScorecard(entryId: string): Scorecard | null {
  const prep = readPrepRow(entryId);
  const sc = (prep?.payload as { humanScorecard?: Scorecard } | undefined)?.humanScorecard;
  return sc ?? null;
}

/** Every human scorecard on an entry's prep artifact, one per (interviewer, round),
 *  SCOPED to the workspace (the same predicate as getInterviewPrep). A row written
 *  before the list existed reads as its one unattributed record. */
export function getHumanScorecards(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): HumanScorecardRecord[] {
  const prep = getInterviewPrep(entryId, workspaceId);
  return prep ? readHumanScorecards(prep.payload) : [];
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

type PrepRow = { entry_id: string; candidate_label: string | null; job_title: string | null; payload_json: string; created_at: string };

/** Parse one row into the public shape; null on a corrupt payload_json. */
function toPrep(row: PrepRow | undefined): InterviewPrep | null {
  if (!row) return null;
  try {
    return { entryId: row.entry_id, candidateLabel: row.candidate_label, jobTitle: row.job_title, payload: JSON.parse(row.payload_json), createdAt: row.created_at };
  } catch {
    /* corrupt payload_json — the artifact is unreadable, so there is no prep to return */
    return null;
  }
}

/** The UNSCOPED read, for this module's own read-merge-write helpers. Each of them is
 *  reached only through a caller that already owns the entry, and each is keyed by the
 *  globally-unique entry_id — so re-asserting a workspace they were never given would
 *  turn a legitimate non-default-tenant save into a silent no-op. Kept private: the
 *  EXPORTED read below is the one a trust boundary calls. */
function readPrepRow(entryId: string): InterviewPrep | null {
  return toPrep(
    db()
      .prepare(`SELECT entry_id, candidate_label, job_title, payload_json, created_at FROM interview_preps WHERE entry_id = ?`)
      .get(entryId) as PrepRow | undefined
  );
}

/** One entry's prep artifact, SCOPED to a workspace (tenancy, /perfect 2026-09-03,
 *  schedule-ui-2). All four verbs of /api/interview-prep read this by entry id alone
 *  and leaned on id-unguessability: an id from another team's board returned that
 *  team's candidate name, job title, tailored scenario, the interviewer's verbatim
 *  notes and their saved human scorecard — and the POST/PATCH wrote back into it. The
 *  row has carried `workspace_id` since E0 Phase 1; this is the predicate that finally
 *  uses it. Default-signature shape, like its neighbours `prepJdEditedAt` and
 *  `listPreparedEntries`. */
export function getInterviewPrep(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): InterviewPrep | null {
  return toPrep(
    db()
      .prepare(
        `SELECT entry_id, candidate_label, job_title, payload_json, created_at
           FROM interview_preps WHERE entry_id = ? AND workspace_id = ?`
      )
      .get(entryId, workspaceId) as PrepRow | undefined
  );
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
    // TENANCY: `workspaceId` reached this function only to scope the JD-staleness join
    // below — the roster query itself matched entry ids across EVERY team, so a board
    // id from another workspace came back with that team's generated-at stamp, the
    // assigned interviewer's name and the has-a-human-scorecard flag. Same predicate
    // the by-id read now carries.
    const rows = db()
      .prepare(
        `SELECT entry_id, payload_json, created_at
           FROM interview_preps WHERE workspace_id = ? AND entry_id IN (${placeholders})`
      )
      .all(workspaceId, ...ids) as { entry_id: string; payload_json: string; created_at: string }[];
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
