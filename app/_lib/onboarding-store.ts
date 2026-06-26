import Database from "better-sqlite3";
import { openStore } from "./db-path";
import { randomId } from "./random-id";
import {
  coerceQuestionnaire,
  coerceTasks,
  DEFAULT_ONBOARDING_TASKS,
  DEFAULT_QUESTIONNAIRE,
  onboardingProgress,
  type OnboardingProgress,
  type OnboardingTask,
  type OnboardingTaskState,
  type QuestionnaireField,
} from "./onboarding";

// Onboarding hand-off store (#6) — isolated connection on the shared kp.sqlite,
// same pattern as schedule-store / offers-store. Owns the onboarding_* tables:
// reusable checklist templates, one run per Hired candidate, per-run task states,
// the pre-boarding entry questionnaire, and the e-signature SEAM (markSigned is
// where a real eIDAS provider wires in — see onboarding.ts).

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS onboarding_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tasks_json TEXT NOT NULL,
      questionnaire_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS onboarding_runs (
      id TEXT PRIMARY KEY,
      entry_id TEXT UNIQUE,
      template_id TEXT NOT NULL,
      candidate_label TEXT,
      job_title TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      reminder_sent_at TEXT
    );
    CREATE TABLE IF NOT EXISTS onboarding_task_states (
      run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      done_at TEXT,
      PRIMARY KEY (run_id, task_id)
    );
    CREATE TABLE IF NOT EXISTS onboarding_intake (
      run_id TEXT PRIMARY KEY,
      answers_json TEXT NOT NULL,
      submitted_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS onboarding_signatures (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      document TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'requested',
      signer TEXT,
      requested_at TEXT NOT NULL,
      signed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_onboarding_sig_run ON onboarding_signatures (run_id);
  `);
  // Migration (P1-4): add the per-template questionnaire column to template tables
  // created before the questionnaire became editable data. Pre-existing rows read
  // back as the default questionnaire (parseQuestionnaire's null fallback).
  const cols = d.prepare(`PRAGMA table_info(onboarding_templates)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "questionnaire_json")) {
    d.exec(`ALTER TABLE onboarding_templates ADD COLUMN questionnaire_json TEXT`);
  }
  // Migration (CW-4): the at-most-once pre-boarding reminder claim column on runs
  // created before the nudge existed (pre-existing rows read back NULL = un-reminded).
  const runCols = d.prepare(`PRAGMA table_info(onboarding_runs)`).all() as { name: string }[];
  if (!runCols.some((c) => c.name === "reminder_sent_at")) {
    d.exec(`ALTER TABLE onboarding_runs ADD COLUMN reminder_sent_at TEXT`);
  }
  _db = d;
  return d;
}

export type OnboardingTemplate = { id: string; name: string; tasks: OnboardingTask[]; questionnaire: QuestionnaireField[] };
export type OnboardingRun = {
  id: string;
  entryId: string | null;
  templateId: string;
  candidateLabel: string | null;
  jobTitle: string | null;
  status: string;
  startedAt: string;
  completedAt: string | null;
  reminderSentAt: string | null;
};
export type OnboardingSignature = {
  id: string;
  runId: string;
  document: string;
  status: string;
  signer: string | null;
  requestedAt: string;
  signedAt: string | null;
};
export type OnboardingRunDetail = {
  run: OnboardingRun;
  tasks: OnboardingTask[];
  questionnaire: QuestionnaireField[];
  states: OnboardingTaskState[];
  intake: Record<string, string> | null;
  signatures: OnboardingSignature[];
  progress: OnboardingProgress;
};

function parseTasks(json: string): OnboardingTask[] {
  try {
    return coerceTasks(JSON.parse(json));
  } catch {
    return [];
  }
}

/** Parse a template's questionnaire. A NULL column is a pre-P1-4 template — it falls
 *  back to the default questionnaire so it still presents a usable form. A stored
 *  "[]" is an intentional empty questionnaire and is honoured. */
function parseQuestionnaire(json: string | null | undefined): QuestionnaireField[] {
  if (json == null) return [...DEFAULT_QUESTIONNAIRE];
  try {
    return coerceQuestionnaire(JSON.parse(json));
  } catch {
    return [...DEFAULT_QUESTIONNAIRE];
  }
}

/** Seed the single default template on first use so a fresh tenant has a runnable
 *  checklist (idempotent — only seeds when the table is empty). Returns its id. */
export function ensureDefaultTemplate(): string {
  const d = db();
  const existing = d.prepare(`SELECT id FROM onboarding_templates ORDER BY created_at ASC LIMIT 1`).get() as
    | { id: string }
    | undefined;
  if (existing) return existing.id;
  const id = randomId("obt");
  d.prepare(`INSERT INTO onboarding_templates (id, name, tasks_json, questionnaire_json, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    id,
    "Standard onboarding",
    JSON.stringify(DEFAULT_ONBOARDING_TASKS),
    JSON.stringify(DEFAULT_QUESTIONNAIRE),
    new Date().toISOString()
  );
  return id;
}

export function listTemplates(): OnboardingTemplate[] {
  ensureDefaultTemplate();
  return (db().prepare(`SELECT id, name, tasks_json, questionnaire_json FROM onboarding_templates ORDER BY created_at ASC`).all() as {
    id: string;
    name: string;
    tasks_json: string;
    questionnaire_json: string | null;
  }[]).map((r) => ({ id: r.id, name: r.name, tasks: parseTasks(r.tasks_json), questionnaire: parseQuestionnaire(r.questionnaire_json) }));
}

export function createTemplate(name: string, tasks: unknown, questionnaire?: unknown): OnboardingTemplate {
  const id = randomId("obt");
  const clean = coerceTasks(tasks);
  // undefined questionnaire (legacy caller) → default; an explicit value (incl. [])
  // is the recruiter's choice and is honoured.
  const cleanQ = questionnaire === undefined ? [...DEFAULT_QUESTIONNAIRE] : coerceQuestionnaire(questionnaire);
  const cleanName = name.trim().slice(0, 120) || "Untitled";
  db()
    .prepare(`INSERT INTO onboarding_templates (id, name, tasks_json, questionnaire_json, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, cleanName, JSON.stringify(clean), JSON.stringify(cleanQ), new Date().toISOString());
  return { id, name: cleanName, tasks: clean, questionnaire: cleanQ };
}

function rowToRun(r: Record<string, unknown>): OnboardingRun {
  return {
    id: r.id as string,
    entryId: (r.entry_id as string) ?? null,
    templateId: r.template_id as string,
    candidateLabel: (r.candidate_label as string) ?? null,
    jobTitle: (r.job_title as string) ?? null,
    status: r.status as string,
    startedAt: r.started_at as string,
    completedAt: (r.completed_at as string) ?? null,
    reminderSentAt: (r.reminder_sent_at as string) ?? null,
  };
}

/** Start (or return the existing) onboarding run for a Hired candidate — one run
 *  per entry (UNIQUE entry_id). Defaults to the seeded template when none given. */
export function startRun(input: {
  entryId: string;
  templateId?: string | null;
  candidateLabel?: string | null;
  jobTitle?: string | null;
}): OnboardingRun {
  const d = db();
  const existing = d.prepare(`SELECT * FROM onboarding_runs WHERE entry_id = ?`).get(input.entryId) as
    | Record<string, unknown>
    | undefined;
  if (existing) return rowToRun(existing);
  const id = randomId("obr");
  const templateId = input.templateId || ensureDefaultTemplate();
  d.prepare(
    `INSERT INTO onboarding_runs (id, entry_id, template_id, candidate_label, job_title, status, started_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`
  ).run(id, input.entryId, templateId, input.candidateLabel ?? null, input.jobTitle ?? null, new Date().toISOString());
  const row = d.prepare(`SELECT * FROM onboarding_runs WHERE id = ?`).get(id) as Record<string, unknown>;
  return rowToRun(row);
}

export function runForEntry(entryId: string): OnboardingRun | null {
  const row = db().prepare(`SELECT * FROM onboarding_runs WHERE entry_id = ?`).get(entryId) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToRun(row) : null;
}

function taskStates(runId: string): OnboardingTaskState[] {
  return (db().prepare(`SELECT task_id, done, done_at FROM onboarding_task_states WHERE run_id = ?`).all(runId) as {
    task_id: string;
    done: number;
    done_at: string | null;
  }[]).map((r) => ({ taskId: r.task_id, done: r.done === 1, doneAt: r.done_at }));
}

function templateTasks(templateId: string): OnboardingTask[] {
  const row = db().prepare(`SELECT tasks_json FROM onboarding_templates WHERE id = ?`).get(templateId) as
    | { tasks_json: string }
    | undefined;
  return row ? parseTasks(row.tasks_json) : [];
}

function templateQuestionnaire(templateId: string): QuestionnaireField[] {
  const row = db().prepare(`SELECT questionnaire_json FROM onboarding_templates WHERE id = ?`).get(templateId) as
    | { questionnaire_json: string | null }
    | undefined;
  return row ? parseQuestionnaire(row.questionnaire_json) : [...DEFAULT_QUESTIONNAIRE];
}

/** Every run with its completion rollup — the onboarding tab's list. `intakeSubmitted`
 *  lets the recruiter card show pre-boarding questionnaire pending/done (CW-4) so a
 *  hire whose candidate hasn't filled it in is visible, not silently empty. */
export function listRuns(): (OnboardingRun & { progress: OnboardingProgress; intakeSubmitted: boolean })[] {
  const d = db();
  const runs = (d.prepare(`SELECT * FROM onboarding_runs ORDER BY started_at DESC`).all() as Record<string, unknown>[]).map(
    rowToRun
  );
  // One read of which runs have a submitted intake, rather than N per-run detail loads.
  const withIntake = new Set(
    (d.prepare(`SELECT run_id FROM onboarding_intake`).all() as { run_id: string }[]).map((r) => r.run_id)
  );
  return runs.map((run) => ({
    ...run,
    progress: onboardingProgress(templateTasks(run.templateId), taskStates(run.id)),
    intakeSubmitted: withIntake.has(run.id),
  }));
}

/** Runs due their one pre-boarding-intake nudge (CW-4): active, intake still
 *  unsubmitted, never reminded, and started at/before the policy cutoff. The cutoff
 *  bound keeps not-yet-due runs out of the result entirely. */
export function duePreboardingReminders(cutoffIso: string): OnboardingRun[] {
  const rows = db()
    .prepare(
      `SELECT r.* FROM onboarding_runs r
        LEFT JOIN onboarding_intake i ON i.run_id = r.id
        WHERE r.status = 'active'
          AND r.reminder_sent_at IS NULL
          AND i.run_id IS NULL
          AND r.started_at <= ?
        ORDER BY r.started_at ASC`
    )
    .all(cutoffIso) as Record<string, unknown>[];
  return rows.map(rowToRun);
}

/** CAS-claim the one-shot pre-boarding reminder (CW-4): stamps reminder_sent_at only
 *  if still NULL, so a re-tick or a second process can't double-nudge. Returns true
 *  for the single claimer that flipped it. */
export function markPreboardingReminded(runId: string, nowIso: string = new Date().toISOString()): boolean {
  const res = db()
    .prepare(`UPDATE onboarding_runs SET reminder_sent_at = ? WHERE id = ? AND reminder_sent_at IS NULL`)
    .run(nowIso, runId);
  return res.changes > 0;
}

export function getRunDetail(runId: string): OnboardingRunDetail | null {
  const d = db();
  const row = d.prepare(`SELECT * FROM onboarding_runs WHERE id = ?`).get(runId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const run = rowToRun(row);
  const tasks = templateTasks(run.templateId);
  const questionnaire = templateQuestionnaire(run.templateId);
  const states = taskStates(run.id);
  const intakeRow = d.prepare(`SELECT answers_json FROM onboarding_intake WHERE run_id = ?`).get(runId) as
    | { answers_json: string }
    | undefined;
  let intake: Record<string, string> | null = null;
  if (intakeRow) {
    try {
      intake = JSON.parse(intakeRow.answers_json) as Record<string, string>;
    } catch {
      intake = null;
    }
  }
  const signatures = (d.prepare(`SELECT * FROM onboarding_signatures WHERE run_id = ? ORDER BY requested_at ASC`).all(runId) as Record<string, unknown>[]).map(
    (s) => ({
      id: s.id as string,
      runId: s.run_id as string,
      document: s.document as string,
      status: s.status as string,
      signer: (s.signer as string) ?? null,
      requestedAt: s.requested_at as string,
      signedAt: (s.signed_at as string) ?? null,
    })
  );
  return { run, tasks, questionnaire, states, intake, signatures, progress: onboardingProgress(tasks, states) };
}

/** Toggle a checklist task; auto-completes the run when the last one is checked
 *  (and re-opens it if a task is later unchecked). Returns the fresh detail. */
export function setTaskDone(runId: string, taskId: string, done: boolean): OnboardingRunDetail | null {
  const d = db();
  const run = d.prepare(`SELECT id FROM onboarding_runs WHERE id = ?`).get(runId);
  if (!run) return null;
  const now = new Date().toISOString();
  d.prepare(
    `INSERT INTO onboarding_task_states (run_id, task_id, done, done_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(run_id, task_id) DO UPDATE SET done = excluded.done, done_at = excluded.done_at`
  ).run(runId, taskId, done ? 1 : 0, done ? now : null);
  const detail = getRunDetail(runId)!;
  const shouldComplete = detail.progress.complete;
  d.prepare(`UPDATE onboarding_runs SET status = ?, completed_at = ? WHERE id = ?`).run(
    shouldComplete ? "complete" : "active",
    shouldComplete ? now : null,
    runId
  );
  return getRunDetail(runId);
}

const INTAKE_VALUE_MAX = 500;

/** Persist the pre-boarding questionnaire (last write wins). Bounds every value;
 *  keys are taken as-is from the validated form. */
export function saveIntake(runId: string, answers: Record<string, unknown>): OnboardingRunDetail | null {
  const d = db();
  const run = d.prepare(`SELECT id FROM onboarding_runs WHERE id = ?`).get(runId);
  if (!run) return null;
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers)) {
    if (typeof v === "string" && v.trim()) clean[k.slice(0, 64)] = v.trim().slice(0, INTAKE_VALUE_MAX);
  }
  d.prepare(
    `INSERT INTO onboarding_intake (run_id, answers_json, submitted_at) VALUES (?, ?, ?)
     ON CONFLICT(run_id) DO UPDATE SET answers_json = excluded.answers_json, submitted_at = excluded.submitted_at`
  ).run(runId, JSON.stringify(clean), new Date().toISOString());
  return getRunDetail(runId);
}

/** Request a signature on a document — the e-sign SEAM. In a real deployment this
 *  is where the eIDAS provider (Signicat/DocuSign) create-envelope call goes; here
 *  it records a 'requested' row that markSigned resolves. */
export function requestSignature(runId: string, document: string): OnboardingRunDetail | null {
  const d = db();
  const run = d.prepare(`SELECT id FROM onboarding_runs WHERE id = ?`).get(runId);
  if (!run) return null;
  d.prepare(
    `INSERT INTO onboarding_signatures (id, run_id, document, status, requested_at) VALUES (?, ?, ?, 'requested', ?)`
  ).run(randomId("obs"), runId, document.trim().slice(0, 200) || "Document", new Date().toISOString());
  return getRunDetail(runId);
}

/** Mark a requested signature as signed (provider seam — a real eIDAS callback
 *  would land here with the verified signer + timestamp). Audit-stamped. */
export function markSigned(signatureId: string, signer: string): OnboardingRunDetail | null {
  const d = db();
  const row = d.prepare(`SELECT run_id FROM onboarding_signatures WHERE id = ?`).get(signatureId) as
    | { run_id: string }
    | undefined;
  if (!row) return null;
  d.prepare(`UPDATE onboarding_signatures SET status = 'signed', signer = ?, signed_at = ? WHERE id = ? AND status = 'requested'`).run(
    signer.trim().slice(0, 120) || "Signed",
    new Date().toISOString(),
    signatureId
  );
  return getRunDetail(row.run_id);
}
