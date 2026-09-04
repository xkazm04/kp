// The boot TAIL — the two maintenance steps that run after the schema is ready — and the
// order the boot body runs in.
//
// Both tail steps are deliberately best-effort: a prompt-cache prune failure and a WAL
// checkpoint failure must be logged and survived, never allowed to wedge a boot. That is a
// real decision, and until now it had NO test at all: `grep wal_checkpoint|prunePromptCache
// app/_lib/db/*.test.ts` returned nothing, so deleting either call, or turning either catch
// into a re-throw, was a silent change. The prune in particular is the only thing bounding
// the gemini_cache table and its WAL for the life of a deployment.
//
// The tail is exercised through `runBootMaintenance`, the seam ensureDb() calls: the
// failure halves need a db/prune that fails on demand, which no real database offers
// deterministically. The end-to-end half (a real boot really prunes, and really folds the
// WAL back) runs in a child process against a throwaway file.
//
// The last test here pins the ORDER of the boot body — specifically that fixture seeding
// runs BEFORE the PK rebuilds and the NULL backfills, which is safe today and was stated
// nowhere. Temp files live under this file's own private root, which is deliberately NOT
// removed in an after() hook.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runBootMaintenance } from "./core.ts";

const ROOT = mkdtempSync(path.join(os.tmpdir(), "kp-boot-tail-"));

/** Run `body` with console.log/warn/error captured, and return every line it wrote. */
function captureConsole(body: () => void): { out: string; threw: unknown } {
  const lines: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const sink = (...args: unknown[]) => {
    lines.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  };
  console.log = sink;
  console.warn = sink;
  console.error = sink;
  let threw: unknown;
  try {
    body();
  } catch (error) {
    threw = error;
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
  return { out: lines.join("\n"), threw };
}

const okDb = { pragma: () => undefined };

test("a prompt-cache prune failure is logged and survived — boot is never wedged by it", () => {
  const { out, threw } = captureConsole(() =>
    runBootMaintenance(okDb, () => {
      throw new Error("cannot modify gemini_cache because it is a view");
    })
  );
  assert.equal(threw, undefined, "a prune failure must not propagate out of boot");
  assert.match(out, /prompt-cache boot prune failed/, "and it must be logged, not swallowed silently");
  assert.match(out, /cannot modify gemini_cache/, "the log carries the underlying reason");
});

test("a WAL checkpoint failure is logged and survived, and does not skip the prune", () => {
  const failingDb = {
    pragma: () => {
      throw new Error("database is locked");
    },
  };
  const { out, threw } = captureConsole(() => runBootMaintenance(failingDb, () => 7));
  assert.equal(threw, undefined, "a checkpoint failure must not propagate out of boot");
  assert.match(out, /boot WAL checkpoint failed/, "and it must be logged");
  assert.match(out, /database is locked/, "with the underlying reason");
  assert.match(out, /pruned 7 expired prompt-cache row\(s\)/, "the prune ran first and reported its work");
});

test("a clean tail says nothing when there was nothing to prune", () => {
  const { out, threw } = captureConsole(() => runBootMaintenance(okDb, () => 0));
  assert.equal(threw, undefined);
  assert.equal(out, "", "zero pruned rows is the ordinary case — it must not add a boot log line");
});

// ---- End to end: a real boot really prunes, and really folds the WAL back -----------
const BOOT_CHILD = `
import path from "node:path";
import { pathToFileURL } from "node:url";

process.env.NODE_TEST_CONTEXT = "child-v8";
delete process.env.KP_MULTI_WORKSPACE;

const core = await import(pathToFileURL(path.join(process.cwd(), "app/_lib/db/core.ts")).href);
try {
  core.ensureDb();
  console.log("BOOT ok");
} catch (error) {
  console.log("BOOT refused " + (error instanceof Error ? error.message : String(error)));
}
`;

function boot(dbPath: string): { ok: boolean; stdout: string; stderr: string } {
  const res = spawnSync(
    process.execPath,
    [
      "--import",
      "./scripts/test-alias-loader.mjs",
      "--experimental-transform-types",
      "--disable-warning=ExperimentalWarning",
      "--input-type=module",
      "-e",
      BOOT_CHILD,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, KP_DB_PATH: dbPath, NO_COLOR: "1", FORCE_COLOR: "0", KP_EMPTY: "1" },
    }
  );
  assert.match(res.stdout, /BOOT (ok|refused)/, `child reported no verdict\n${res.stdout}\n${res.stderr}`);
  return { ok: /BOOT ok/.test(res.stdout), stdout: res.stdout, stderr: res.stderr };
}

test("boot prunes expired prompt-cache rows, keeps live ones, and truncates the WAL", () => {
  const dbPath = path.join(mkdtempSync(path.join(ROOT, "prune-")), "kp.sqlite");
  assert.ok(boot(dbPath).ok, "fixture setup: a fresh DB must boot");

  const seed = new Database(dbPath);
  const insert = seed.prepare(
    `INSERT INTO gemini_cache (hash, payload_json, prompt_version, created_at, expires_at) VALUES (?, '{}', 'v1', '2024-01-01T00:00:00.000Z', ?)`
  );
  insert.run("expired-a", "2024-01-02T00:00:00.000Z");
  insert.run("expired-b", "2024-01-02T00:00:00.000Z");
  insert.run("live", "2999-01-01T00:00:00.000Z");
  seed.close();

  const second = boot(dbPath);
  assert.ok(second.ok, "the boot that prunes must still be a successful boot");
  assert.match(
    second.stdout,
    /pruned 2 expired prompt-cache row\(s\) on boot/,
    "boot reports the reclaim — the table is otherwise unbounded and nothing else says so"
  );

  const after = new Database(dbPath, { readonly: true });
  const rows = (after.prepare(`SELECT hash FROM gemini_cache`).all() as { hash: string }[]).map((r) => r.hash);
  after.close();
  assert.deepEqual(rows, ["live"], "only the expired rows go; a live cache entry is never pruned");

  // wal_checkpoint(TRUNCATE) folds the committed pages back into the main file AND shrinks
  // the sidecar to zero. A non-zero -wal after boot means the checkpoint stopped running.
  let walBytes = 0;
  try {
    walBytes = statSync(`${dbPath}-wal`).size;
  } catch {
    walBytes = 0; // no sidecar at all is the same outcome: nothing left to fold back
  }
  assert.equal(walBytes, 0, "the boot checkpoint must truncate the -wal sidecar");
});

// ---- The order the boot body runs in ------------------------------------------------
//
// Fixture seeding sits BEFORE the PK-widening rebuilds and the workspace_id backfills.
// That is correct — and it is correct for a REASON that lived only in the head of whoever
// wrote it, which is exactly the kind of ordering a later edit reshuffles without noticing.
// Pin it, and require the reason to be written down beside it.
test("fixture seeding runs before the PK rebuilds and the NULL backfills, with the reason stated", () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "core.ts"),
    "utf8"
  ).replace(/\r\n/g, "\n");

  const at = (needle: string): number => {
    const i = source.indexOf(needle);
    assert.notEqual(i, -1, `core.ts no longer contains ${JSON.stringify(needle)} — update this ordering test`);
    return i;
  };

  const seeding = at("if (fixtureSeedEnabled()) {");
  const stageMigration = at("migratePipelineStages(db);");
  const backfill = at("UPDATE analyses SET workspace_id = ? WHERE workspace_id IS NULL");
  const rebuild = at("const rebuildTable = (scratch: string, ddl: string)");

  assert.ok(seeding < stageMigration, "seeding runs before the stage remap");
  assert.ok(
    seeding < backfill,
    "seeding runs BEFORE the workspace_id backfills — that is what makes the backfills order-independent (a seeded row that did not stamp the column is caught)"
  );
  assert.ok(
    seeding < rebuild,
    "seeding runs BEFORE the PK-widening rebuilds, so a rebuild copies the seeded rows across rather than racing them"
  );

  // The reason, not just the order: a bare ordering assertion tells the next editor WHAT
  // to preserve but not WHY, and an unexplained constraint is the one that gets 'tidied'.
  const seedingBlock = source.slice(Math.max(0, seeding - 2000), seeding);
  assert.match(
    seedingBlock,
    /SEED ORDER/,
    "the seeding block must carry a SEED ORDER note explaining why it precedes the rebuilds and backfills"
  );
});
