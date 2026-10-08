// Fixtures for scripts/economics/snapshot.mjs. What they pin:
//   - the aggregates are exact (groups, token sums, unpriced_n, per-task percentiles,
//     outbox and ATS counts);
//   - NONE of the identifying strings seeded into the fixture (recipients, bodies,
//     subjects, request ids, task ids, the fixture path) reaches the output;
//   - the source database is byte-identical after a run, including the WAL case;
//   - keyless vs keyed is stated.
//
//   node scripts/run-unit-tests.mjs "scripts/economics/**/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { buildSnapshot, percentile } from "../snapshot.mjs";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "snapshot.mjs");

const SCHEMA = `
  CREATE TABLE llm_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, use_case TEXT NOT NULL,
    provider TEXT NOT NULL, model TEXT, input_tokens INTEGER, output_tokens INTEGER,
    cached_tokens INTEGER, cost_usd REAL, source TEXT NOT NULL,
    outcome TEXT NOT NULL DEFAULT 'ok', reason TEXT, request_id TEXT);
  CREATE TABLE tasks (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE dev_outbox (id TEXT PRIMARY KEY, recipient TEXT, subject TEXT, body TEXT,
    kind TEXT, channel TEXT, status TEXT NOT NULL, ref TEXT, created_at TEXT NOT NULL);
  CREATE TABLE ats_delivery (id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL,
    entry_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
    last_status INTEGER, last_error TEXT, next_attempt_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
`;

// Strings that must never appear in any output.
const SECRETS = [
  "jane.doe@example.org",
  "Your offer from Acme",
  "Dear Jane, we are delighted",
  "task-secret-aaa",
  "task-secret-bbb",
  "task-secret-ccc",
  "req-secret-orphan",
  "entry-secret-1",
];

function fixture({ keyed, wal = false } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kp-econ-test-"));
  const file = path.join(dir, "fixture.sqlite");
  const db = new Database(file);
  if (wal) db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  const task = db.prepare(`INSERT INTO tasks (id, kind, status, created_at) VALUES (?, ?, 'done', '2026-10-01T00:00:00Z')`);
  task.run("task-secret-aaa", "jd_build");
  task.run("task-secret-bbb", "jd_build");
  task.run("task-secret-ccc", "devcase_lifecycle");
  const use = db.prepare(
    `INSERT INTO llm_usage (ts, use_case, provider, model, input_tokens, output_tokens, cached_tokens, cost_usd, source, outcome, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // jd_build task aaa: 0.10 + 0.20 = 0.30; bbb: 0.50 (and an unpriced row); ccc: a template.
  use.run("2026-10-02T10:00:00Z", "devcase_analyze", "deterministic", null, 0, 0, null, 0.0, "deterministic", "ok", "task-secret-aaa");
  use.run("2026-10-02T10:01:00Z", "devcase_case_design", "deterministic", null, 0, 0, null, 0.0, "deterministic", "ok", "task-secret-aaa");
  use.run("2026-10-03T10:00:00Z", "devcase_analyze", "deterministic", null, 0, 0, null, 0.0, "deterministic", "ok", "task-secret-ccc");
  use.run("2026-10-04T10:00:00Z", "jd_ingest", "claude_cli", null, 100, 50, null, null, "llm", "ok", "req-secret-orphan");
  use.run("2026-10-05T10:00:00Z", "jd_ingest", "claude_cli", null, 10, 5, null, null, "llm", "failed", null);
  if (keyed) {
    use.run("2026-10-06T10:00:00Z", "devcase_analyze", "anthropic", "claude-sonnet-5", 1000, 200, 5, 0.1, "llm", "ok", "task-secret-aaa");
    use.run("2026-10-06T10:01:00Z", "devcase_analyze", "anthropic", "claude-sonnet-5", 2000, 400, 0, 0.2, "llm", "ok", "task-secret-aaa");
    use.run("2026-10-06T10:02:00Z", "devcase_analyze", "anthropic", "claude-sonnet-5", 3000, 600, 0, 0.5, "llm", "ok", "task-secret-bbb");
    use.run("2026-10-06T10:03:00Z", "devcase_analyze", "anthropic", "claude-sonnet-5", 7, 7, 0, null, "llm", "ok", "task-secret-bbb");
  }
  const mail = db.prepare(
    `INSERT INTO dev_outbox (id, recipient, subject, body, kind, channel, status, ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-10-02T00:00:00Z')`,
  );
  for (let i = 0; i < 3; i += 1) mail.run(`mail-${i}`, "jane.doe@example.org", "Your offer from Acme", "Dear Jane, we are delighted", "offer", "outbox", "queued", "entry-secret-1");
  mail.run("mail-9", "jane.doe@example.org", "Your offer from Acme", "Dear Jane, we are delighted", "offer", "webhook", "sent", "entry-secret-1");
  mail.run("mail-10", "jane.doe@example.org", "Your offer from Acme", "Dear Jane, we are delighted", "ack", "webhook", "failed", "entry-secret-1");
  const ats = db.prepare(
    `INSERT INTO ats_delivery (event, entry_id, status, attempts, created_at, updated_at) VALUES ('hired', 'entry-secret-1', ?, ?, '2026-10-02T00:00:00Z', '2026-10-02T00:00:00Z')`,
  );
  ats.run("delivered", 1);
  ats.run("delivered", 1);
  ats.run("failed", 6);
  ats.run("pending", 0);
  return { dir, file, db };
}

const bytes = (f) => readFileSync(f);
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

test("percentile is nearest-rank", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([1], 90), 1);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
});

test("a keyless database: exact aggregates, stated as keyless", () => {
  const { dir, db } = fixture({ keyed: false });
  try {
    const s = buildSnapshot(db, { source: "KP_DB_PATH", fileName: "fixture.sqlite", generatedAt: "2026-10-08T00:00:00Z" });
    assert.equal(s.database.kind, "keyless");
    assert.equal(s.database.priced_non_deterministic_rows, 0);
    assert.equal(s.database.non_deterministic_rows, 2);
    assert.equal(s.n, 5);
    assert.deepEqual(s.window, { start: "2026-10-02T10:00:00Z", end: "2026-10-05T10:00:00Z" });
    assert.deepEqual(s.row_counts, { llm_usage: 5, tasks: 3, dev_outbox: 5, ats_delivery: 4 });
    const det = s.llm_usage.find((g) => g.use_case === "devcase_analyze" && g.provider === "deterministic");
    assert.deepEqual(
      { n: det.n, cost: det.cost_usd, unpriced: det.unpriced_n, outcome: det.outcome },
      { n: 2, cost: 0, unpriced: 0, outcome: "ok" },
    );
    const cli = s.llm_usage.filter((g) => g.use_case === "jd_ingest");
    assert.equal(cli.length, 2);
    assert.equal(cli.find((g) => g.outcome === "ok").input_tokens, 100);
    assert.equal(cli.find((g) => g.outcome === "failed").unpriced_n, 1);
    assert.deepEqual(
      s.dev_outbox.map((r) => [r.kind, r.channel, r.status, r.n]),
      [["ack", "webhook", "failed", 1], ["offer", "outbox", "queued", 3], ["offer", "webhook", "sent", 1]],
    );
    assert.deepEqual(s.ats_delivery.by_status, [
      { status: "delivered", n: 2 }, { status: "failed", n: 1 }, { status: "pending", n: 1 },
    ]);
    assert.deepEqual(s.ats_delivery.attempts_histogram, [
      { attempts: 0, n: 1 }, { attempts: 1, n: 2 }, { attempts: 6, n: 1 },
    ]);
  } finally {
    db.close();
    cleanup(dir);
  }
});

test("a keyed database: per-task percentiles and the unpriced count are exact", () => {
  const { dir, db } = fixture({ keyed: true });
  try {
    const s = buildSnapshot(db, {});
    assert.equal(s.database.kind, "keyed");
    assert.equal(s.database.priced_non_deterministic_rows, 3);
    const g = s.llm_usage.find((x) => x.provider === "anthropic");
    assert.deepEqual(
      { n: g.n, i: g.input_tokens, o: g.output_tokens, c: g.cached_tokens, usd: g.cost_usd, unpriced: g.unpriced_n },
      { n: 4, i: 6007, o: 1207, c: 5, usd: 0.8, unpriced: 1 },
    );
    const jd = s.task_kinds.find((k) => k.kind === "jd_build");
    // aaa = 0.30, bbb = 0.50 (+ one unpriced row, so bbb is an unpriced task)
    assert.deepEqual(jd, { kind: "jd_build", tasks: 2, unpriced_tasks: 1, cost_per_task_usd: { p50: 0.3, p90: 0.5, max: 0.5 } });
    const dc = s.task_kinds.find((k) => k.kind === "devcase_lifecycle");
    assert.deepEqual(dc.cost_per_task_usd, { p50: 0, p90: 0, max: 0 });
  } finally {
    db.close();
    cleanup(dir);
  }
});

test("the CLI output holds no identifying string and leaves the source untouched", () => {
  const { dir, file, db } = fixture({ keyed: true });
  db.close();
  const out = path.join(dir, "out.json");
  try {
    const before = bytes(file);
    const stdout = execFileSync(process.execPath, [SCRIPT, "--out", out], {
      env: { ...process.env, KP_DB_PATH: file },
      encoding: "utf8",
    });
    assert.match(stdout, /keyed database/);
    const text = readFileSync(out, "utf8");
    for (const secret of [...SECRETS, dir, file, "fixture-body"]) {
      assert.ok(!text.includes(secret), `the snapshot leaked ${secret}`);
      assert.ok(!stdout.includes(secret), `stdout leaked ${secret}`);
    }
    assert.equal(JSON.parse(text).database.file_name, "fixture.sqlite");
    assert.ok(bytes(file).equals(before), "the source database changed");
  } finally {
    cleanup(dir);
  }
});

test("a database with a -wal file is read from a copy and the source stays byte-identical", () => {
  const { dir, file, db } = fixture({ keyed: false, wal: true });
  // Keep the writer open so the -wal file exists, as it does under a running server.
  const out = path.join(dir, "out-wal.json");
  try {
    assert.ok(existsSync(`${file}-wal`), "fixture must carry a -wal file");
    const before = [bytes(file), bytes(`${file}-wal`)];
    execFileSync(process.execPath, [SCRIPT, "--out", out], {
      env: { ...process.env, KP_DB_PATH: file },
      encoding: "utf8",
    });
    const s = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(s.n, 5, "rows living only in the WAL must be counted");
    assert.match(s.database.read_via, /copy of db\+wal/);
    assert.ok(bytes(file).equals(before[0]), "the main database file changed");
    assert.ok(bytes(`${file}-wal`).equals(before[1]), "the wal file changed");
    for (const secret of SECRETS) assert.ok(!JSON.stringify(s).includes(secret));
  } finally {
    db.close();
    cleanup(dir);
  }
});

test("a database missing optional tables still yields a snapshot", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kp-econ-test-"));
  const db = new Database(path.join(dir, "bare.sqlite"));
  db.exec(`CREATE TABLE llm_usage (id INTEGER PRIMARY KEY, ts TEXT NOT NULL, use_case TEXT NOT NULL, provider TEXT NOT NULL,
    model TEXT, input_tokens INTEGER, output_tokens INTEGER, cached_tokens INTEGER, cost_usd REAL, source TEXT NOT NULL,
    outcome TEXT NOT NULL DEFAULT 'ok', reason TEXT, request_id TEXT);`);
  try {
    const s = buildSnapshot(db, {});
    assert.equal(s.n, 0);
    assert.equal(s.database.kind, "keyless");
    assert.equal(s.row_counts.ats_delivery, null);
    assert.deepEqual(s.task_kinds, []);
    assert.deepEqual(s.window, { start: null, end: null });
  } finally {
    db.close();
    cleanup(dir);
  }
});
