import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";

// bug-ui-scan-2026-07-09 (data-store-persistence #3): openStore() must REFUSE to open the
// real dev DB in a test run whose KP_DB_PATH doesn't match the frozen DB_PATH (the
// mis-ordered-import signature) — instead of silently seeding/overwriting data/kp.sqlite.
//
// Driven in a child `node` process so we can control module-load order + env freezing
// without disturbing THIS suite's own isolated connection. The child never targets the
// real DB: both paths it uses are throwaway temp files, so even a broken guard can't touch
// data/kp.sqlite.
const CHILD = `
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(path.join(os.tmpdir(), "kp-guard-"));
process.env.NODE_TEST_CONTEXT = "child-v8";              // mark this a test run
process.env.KP_DB_PATH = path.join(dir, "iso.sqlite");   // DB_PATH freezes to this temp
const mod = await import(pathToFileURL(path.join(process.cwd(), "app/_lib/db-path.ts")).href);

// (1) Positive: a matched, isolated KP_DB_PATH opens fine (proves the guard isn't vacuous).
let ok = false;
try { const d = mod.openStore(); d.close(); ok = true; } catch (e) { console.log("POS_FAIL:" + e.message); }

// (2) Negative: mutate KP_DB_PATH so it no longer matches the frozen DB_PATH — the exact
//     mis-ordered-import shape. openStore() must throw our guard, not open anything.
process.env.KP_DB_PATH = path.join(dir, "other.sqlite");
let guard = "NONE";
try { mod.openStore(); } catch (e) { guard = e.message.includes("data-store-persistence #3") ? "GUARD" : ("OTHER:" + e.message); }

rmSync(dir, { recursive: true, force: true });
console.log("RESULT", ok, guard);
`;

test("openStore refuses a test run whose DB_PATH disagrees with KP_DB_PATH (#3)", () => {
  const res = spawnSync(
    process.execPath,
    [
      "--import",
      "./scripts/test-alias-loader.mjs",
      "--experimental-transform-types",
      "--disable-warning=ExperimentalWarning",
      "--input-type=module",
      "-e",
      CHILD,
    ],
    // NO_COLOR/FORCE_COLOR=0: the child's console.log colourises a boolean when the
    // parent forces colour (FORCE_COLOR is inherited), which turns "true" into
    // "[33mtrue[39m" and silently breaks the match below. Pin the child's
    // output to plain text so this guard asserts the same thing in every terminal.
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", DATABASE_URL: "" } }
  );
  assert.match(res.stdout, /RESULT true GUARD/, `stdout=${res.stdout}\nstderr=${res.stderr}`);
});

// The arm above pins the MISMATCH shape. The two shapes that actually reach a
// developer's real data/kp.sqlite — KP_DB_PATH never set at all, and KP_DB_PATH
// pointed AT the default path — go through the other two clauses of the guard, and
// nothing covered them: delete either clause and every existing test still passed.
//
// Proven WITHOUT ever aiming at the real file: the child runs with its cwd set to a
// throwaway directory, so DEFAULT_DB_PATH (path.resolve(process.cwd(), "data",
// "kp.sqlite")) resolves inside that temp dir. The shape is identical; the blast
// radius is a temp folder. The child also reports whether the file was created, so a
// hollow guard is caught by evidence rather than only by the absence of a throw.
const DEFAULT_PATH_CHILD = `
import path from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const root = process.env.KP_REPO_ROOT;
process.env.NODE_TEST_CONTEXT = "child-v8";   // mark this a test run
delete process.env.KP_DB_PATH;                // …with NO isolated path: DB_PATH freezes to the DEFAULT
const mod = await import(pathToFileURL(path.join(root, "app/_lib/db-path.ts")).href);

// (1) The mis-ordered-import / forgot-to-import-unit-db shape: DB_PATH resolved to
//     <cwd>/data/kp.sqlite, which in a real checkout IS the developer's database.
let unset = "NONE";
try { const d = mod.openStore(); d.close(); } catch (e) { unset = e.message.includes("data-store-persistence #3") ? "GUARD" : ("OTHER:" + e.message); }

// (2) The foot-gun where KP_DB_PATH is set but points at that same default file —
//     env and frozen const AGREE, so only the third clause can refuse it.
process.env.KP_DB_PATH = mod.DEFAULT_DB_PATH;
let dflt = "NONE";
try { const d = mod.openStore(); d.close(); } catch (e) { dflt = e.message.includes("data-store-persistence #3") ? "GUARD" : ("OTHER:" + e.message); }

// Evidence, not just an exception: nothing may have been created at the default path.
const created = existsSync(path.join(process.cwd(), "data", "kp.sqlite"));
console.log("RESULT2", unset, dflt, created);
`;

test("openStore refuses a test run that resolved to the DEFAULT (real) DB path (#3)", () => {
  const sandbox = mkdtempSync(path.join(os.tmpdir(), "kp-guard-cwd-"));
  try {
    const res = spawnSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(path.join(process.cwd(), "scripts/test-alias-loader.mjs")).href,
        "--experimental-transform-types",
        "--disable-warning=ExperimentalWarning",
        "--input-type=module",
        "-e",
        DEFAULT_PATH_CHILD,
      ],
      {
        // cwd is the sandbox, so DEFAULT_DB_PATH points inside it, never at the repo.
        cwd: sandbox,
        encoding: "utf8",
        env: { ...process.env, KP_REPO_ROOT: process.cwd(), NO_COLOR: "1", FORCE_COLOR: "0" },
      }
    );
    assert.match(res.stdout, /RESULT2 GUARD GUARD false/, `stdout=${res.stdout}\nstderr=${res.stderr}`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
