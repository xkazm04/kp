import type Database from "better-sqlite3";
import { ensureDb, seedDemoCorpus } from "./core";
import { seedAlreadyRan } from "./seed-marks";
import { seedChoiceFixedByEnv } from "./seed-gate";

// The first-run data choice (operator triage T1, 2026-10-22): "start empty, or explore
// with demo data?". A fresh database no longer seeds the ČS demo corpus by itself
// (seed-gate.ts); this module is the other half — the recorded answer, the predicate that
// decides whether to ask, and the on-demand seed behind "Explore with demo data".
//
// The answer lives in `workspaces.demo_choice` ('empty' | 'demo' | NULL), a DB setting
// rather than a cookie, so the screen never comes back for anyone on this install.
//
// Only the DEFAULT workspace is ever offered the demo: the corpus seeds into it (and into
// org-default), so offering it to a second team would fill a workspace that is not the one
// the visitor is looking at.

export const DEMO_SEED_WORKSPACE = "workspace";

export type DemoChoice = "empty" | "demo";

type EnvLike = Record<string, string | undefined>;

function readChoice(db: Database.Database, ws: string): DemoChoice | null {
  const row = db.prepare(`SELECT demo_choice FROM workspaces WHERE id = ?`).get(ws) as
    | { demo_choice?: string | null }
    | undefined;
  const v = row?.demo_choice;
  return v === "empty" || v === "demo" ? v : null;
}

export function getDemoChoice(ws: string = DEMO_SEED_WORKSPACE): DemoChoice | null {
  return readChoice(ensureDb(), ws);
}

/** Whether the workspace already holds data someone would mind the demo landing on top of:
 *  any role (the shared reference corpus counts — it IS the demo's job catalog), candidate
 *  profile, analysis, JD or pipeline entry. */
function hasData(db: Database.Database, ws: string): boolean {
  const any = (sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) !== undefined;
  return (
    any(`SELECT 1 FROM jobs WHERE workspace_id = ? OR workspace_id IS NULL LIMIT 1`, ws) ||
    any(`SELECT 1 FROM profiles WHERE workspace_id = ? LIMIT 1`, ws) ||
    any(`SELECT 1 FROM analyses WHERE workspace_id = ? LIMIT 1`, ws) ||
    any(`SELECT 1 FROM jds WHERE workspace_id = ? LIMIT 1`, ws) ||
    any(`SELECT 1 FROM pipeline_entries WHERE workspace_id = ? LIMIT 1`, ws)
  );
}

export function workspaceHasData(ws: string = DEMO_SEED_WORKSPACE): boolean {
  return hasData(ensureDb(), ws);
}

/** The demo was already seeded into this database — at boot (KP_SEED_DEMO=1, or any boot
 *  before the 2026-10-22 flip) or on demand. The pipeline seeder's mark is the witness:
 *  it is the last one-shot fixture seeder whose rows a person would recognise as the demo. */
function demoSeeded(db: Database.Database): boolean {
  return seedAlreadyRan(db, "pipeline");
}

/**
 * Should '/' show the first-run data choice for this workspace? Only when ALL hold:
 *   - it is the default workspace (the only one the demo can seed);
 *   - the environment has not already answered (KP_EMPTY=1 / KP_SEED_DEMO=1);
 *   - nobody has answered in-app (`demo_choice` is NULL);
 *   - the first-run wizard has not been completed or skipped (an established tenant that
 *     happens to be empty is not a first run);
 *   - the demo was never seeded, and the workspace holds no data of its own.
 */
export function demoChoicePending(ws: string, env: EnvLike = process.env): boolean {
  if (ws !== DEMO_SEED_WORKSPACE) return false;
  if (seedChoiceFixedByEnv(env)) return false;
  const db = ensureDb();
  if (readChoice(db, ws) !== null) return false;
  const onboarding = db.prepare(`SELECT onboarding_state FROM workspaces WHERE id = ?`).get(ws) as
    | { onboarding_state?: string | null }
    | undefined;
  if (onboarding?.onboarding_state) return false;
  if (demoSeeded(db)) return false;
  return !hasData(db, ws);
}

/** "Start empty": record the answer so the choice never comes back. Never downgrades a
 *  'demo' answer — the corpus is already on the board, and claiming "empty" would lie. */
export function recordEmptyChoice(ws: string = DEMO_SEED_WORKSPACE): void {
  ensureDb().prepare(`UPDATE workspaces SET demo_choice = 'empty' WHERE id = ? AND demo_choice IS NULL`).run(ws);
}

export type DemoSeedOutcome = "seeded" | "already-seeded" | "refused-has-data" | "refused-workspace";

/**
 * "Explore with demo data": seed the demo corpus on demand and record the answer.
 *
 *   - 'already-seeded'    the demo is on this database already (idempotent repeat, or a
 *                         KP_SEED_DEMO boot); nothing is written except the answer.
 *   - 'refused-has-data'  the workspace holds real data — the demo never lands on top of it.
 *   - 'refused-workspace' not the default workspace (the only one the corpus seeds into).
 *   - 'seeded'            the corpus landed and the tenant is marked onboarded.
 *
 * The read (choice, mark, data) and the write run in ONE IMMEDIATE transaction, so two
 * clicks racing each other serialise: the second sees the first's mark and answers
 * 'already-seeded'. Synchronous throughout; seedDemoCorpus's own transaction nests as a
 * savepoint.
 */
export function seedDemoOnDemand(ws: string): DemoSeedOutcome {
  if (ws !== DEMO_SEED_WORKSPACE) return "refused-workspace";
  const db = ensureDb();
  return db
    .transaction((): DemoSeedOutcome => {
      const recordDemo = () => db.prepare(`UPDATE workspaces SET demo_choice = 'demo' WHERE id = ?`).run(ws);
      if (readChoice(db, ws) === "demo" || demoSeeded(db)) {
        recordDemo();
        return "already-seeded";
      }
      if (hasData(db, ws)) return "refused-has-data";
      seedDemoCorpus(db);
      recordDemo();
      return "seeded";
    })
    .immediate();
}
