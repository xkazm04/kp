#!/usr/bin/env node
// THE EXPORT for the council's economics row: aggregates of what one install has spent
// and sent, in a file a review pack can carry without ever opening a live database.
//
//   npm run economics:snapshot                      # docs/architecture/economics/telemetry-<date>.json
//   npm run economics:snapshot -- --out some.json   # elsewhere
//
// The OPERATOR runs this. It is not a gate and no CI step calls it. It opens the database
// read-only (KP_DB_PATH, else data/kp.sqlite — the env var is optional, never required);
// when a -wal file sits beside it the server is up, so db + wal + shm are copied to a
// temp folder first and the COPY is opened, which leaves the source untouched.
//
// WHAT IT NEVER EXPORTS: an id, a recipient, a subject, a body, a request id, the path of
// the database. Only counts, sums and the closed vocabularies (use case, provider, model,
// outcome, kind, channel, status). llm_usage holds no candidate data by construction
// (app/_lib/tenancy.ts, the llm_usage exemption); dev_outbox does, which is why it is
// reduced to counts here and nothing else.
//
// It states whether the database is KEYLESS (no priced, non-deterministic provider row:
// the shipped default path, at a known $0) or KEYED (real spend). Docs:
// docs/architecture/economics/README.md.
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const SNAPSHOT_SCHEMA = "kp.economics-telemetry.v1";

const tableExists = (db, name) =>
  db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`).get(name) !== undefined;

const countOf = (db, table) => (tableExists(db, table) ? db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n : null);

/** Nearest-rank percentile of an ascending numeric array. */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

function llmUsageSection(db) {
  if (!tableExists(db, "llm_usage")) return { window: { start: null, end: null }, groups: [] };
  const w = db.prepare(`SELECT MIN(ts) AS start, MAX(ts) AS end FROM llm_usage`).get();
  const groups = db
    .prepare(
      `SELECT use_case, provider, model, outcome,
              COUNT(*) AS n,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cached_tokens), 0) AS cached_tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd,
              SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced_n
         FROM llm_usage
        GROUP BY use_case, provider, model, outcome
        ORDER BY use_case, provider, model, outcome`,
    )
    .all()
    .map((g) => ({ ...g, cost_usd: round6(g.cost_usd) }));
  return { window: { start: w.start, end: w.end }, groups };
}

/** One task's cost is the sum of the ok rows sharing its request_id. The request id is
 *  the join key only; it is never copied into the output. */
function perTaskKindSection(db) {
  if (!tableExists(db, "llm_usage") || !tableExists(db, "tasks")) return [];
  const rows = db
    .prepare(
      `SELECT t.kind AS kind, t.id AS task,
              COALESCE(SUM(u.cost_usd), 0) AS cost,
              SUM(CASE WHEN u.cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced
         FROM llm_usage u JOIN tasks t ON t.id = u.request_id
        WHERE u.outcome = 'ok'
        GROUP BY t.kind, t.id`,
    )
    .all();
  const byKind = new Map();
  for (const r of rows) {
    const k = byKind.get(r.kind) ?? { costs: [], unpricedTasks: 0 };
    k.costs.push(r.cost);
    if (r.unpriced > 0) k.unpricedTasks += 1;
    byKind.set(r.kind, k);
  }
  return [...byKind.keys()]
    .sort()
    .map((kind) => {
      const { costs, unpricedTasks } = byKind.get(kind);
      costs.sort((a, b) => a - b);
      return {
        kind,
        tasks: costs.length,
        unpriced_tasks: unpricedTasks,
        cost_per_task_usd: {
          p50: round6(percentile(costs, 50)),
          p90: round6(percentile(costs, 90)),
          max: round6(costs[costs.length - 1]),
        },
      };
    });
}

function outboxSection(db) {
  if (!tableExists(db, "dev_outbox")) return [];
  return db
    .prepare(
      `SELECT kind, channel, status, COUNT(*) AS n
         FROM dev_outbox GROUP BY kind, channel, status ORDER BY kind, channel, status`,
    )
    .all();
}

function atsSection(db) {
  if (!tableExists(db, "ats_delivery")) return { by_status: [], attempts_histogram: [] };
  return {
    by_status: db.prepare(`SELECT status, COUNT(*) AS n FROM ats_delivery GROUP BY status ORDER BY status`).all(),
    attempts_histogram: db
      .prepare(`SELECT attempts, COUNT(*) AS n FROM ats_delivery GROUP BY attempts ORDER BY attempts`)
      .all(),
  };
}

/** The pure half: an open better-sqlite3 handle in, the aggregate record out. */
export function buildSnapshot(db, meta = {}) {
  const usage = llmUsageSection(db);
  const priced = usage.groups.filter((g) => g.provider !== "deterministic" && g.n - g.unpriced_n > 0);
  const nonDeterministic = usage.groups.filter((g) => g.provider !== "deterministic");
  const n = usage.groups.reduce((s, g) => s + g.n, 0);
  return {
    schema: SNAPSHOT_SCHEMA,
    generated_at: meta.generatedAt ?? new Date().toISOString(),
    database: {
      // A label, never a path: a path carries the operator's account name.
      source: meta.source ?? "unknown",
      file_name: meta.fileName ?? null,
      read_via: meta.copiedWal ? "copy of db+wal+shm (the server was running)" : "read-only open",
      // KEYLESS = no priced, non-deterministic provider row. A keyless demo database
      // measures the shipped default path at a known $0 with a real n; a keyed one
      // measures real spend.
      kind: priced.length === 0 ? "keyless" : "keyed",
      non_deterministic_rows: nonDeterministic.reduce((s, g) => s + g.n, 0),
      priced_non_deterministic_rows: priced.reduce((s, g) => s + (g.n - g.unpriced_n), 0),
    },
    window: usage.window,
    n,
    row_counts: {
      llm_usage: countOf(db, "llm_usage"),
      tasks: countOf(db, "tasks"),
      dev_outbox: countOf(db, "dev_outbox"),
      ats_delivery: countOf(db, "ats_delivery"),
    },
    llm_usage: usage.groups,
    task_kinds: perTaskKindSection(db),
    dev_outbox: outboxSection(db),
    ats_delivery: atsSection(db),
  };
}

/** Open `dbPath` read-only; copy the WAL set first when a -wal file exists. Returns the
 *  handle and a cleanup. */
export async function openReadOnly(dbPath) {
  const { default: Database } = await import("better-sqlite3");
  let target = dbPath;
  let tmp = null;
  let copiedWal = false;
  if (existsSync(`${dbPath}-wal`)) {
    tmp = mkdtempSync(path.join(os.tmpdir(), "kp-economics-"));
    target = path.join(tmp, path.basename(dbPath));
    copyFileSync(dbPath, target);
    copyFileSync(`${dbPath}-wal`, `${target}-wal`);
    if (existsSync(`${dbPath}-shm`)) copyFileSync(`${dbPath}-shm`, `${target}-shm`);
    copiedWal = true;
  }
  const db = new Database(target, { readonly: true, fileMustExist: true });
  return {
    db,
    copiedWal,
    close() {
      db.close();
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    },
  };
}

function parseArgs(argv) {
  const i = argv.indexOf("--out");
  return { out: i >= 0 ? argv[i + 1] : null };
}

async function main() {
  const { out } = parseArgs(process.argv.slice(2));
  const fromEnv = process.env.KP_DB_PATH && process.env.KP_DB_PATH.trim() !== "";
  const dbPath = fromEnv ? path.resolve(process.env.KP_DB_PATH) : path.join(REPO_ROOT, "data", "kp.sqlite");
  if (!existsSync(dbPath)) {
    console.error(`economics:snapshot: no database at ${fromEnv ? "KP_DB_PATH" : "data/kp.sqlite"} — nothing to read.`);
    process.exit(1);
  }
  const handle = await openReadOnly(dbPath);
  let snapshot;
  try {
    snapshot = buildSnapshot(handle.db, {
      source: fromEnv ? "KP_DB_PATH" : "data/kp.sqlite",
      fileName: path.basename(dbPath),
      copiedWal: handle.copiedWal,
    });
  } finally {
    handle.close();
  }
  const date = snapshot.generated_at.slice(0, 10);
  const target = out
    ? path.resolve(out)
    : path.join(REPO_ROOT, "docs", "architecture", "economics", `telemetry-${date}.json`);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(
    `economics:snapshot: ${snapshot.database.kind} database, llm_usage n=${snapshot.n}, window ${snapshot.window.start ?? "-"} .. ${snapshot.window.end ?? "-"}`,
  );
  console.log(`wrote ${path.relative(process.cwd(), target) || target}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`economics:snapshot: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
