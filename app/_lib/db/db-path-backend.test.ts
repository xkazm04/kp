// Pins resolveDbBackend behaviour in test vs production contexts.
//
// The failing gate (test:unit 9 failures, 2026-08-30): developers who have a Postgres
// DATABASE_URL in their shell (e.g. a separate project) caused resolveDbBackend to throw in
// every DB-touching test, even though the test was targeting a throwaway SQLite file.
// The fix: in a test context (NODE_TEST_CONTEXT / NODE_ENV=test), ignore the Postgres config
// and proceed with SQLite — the intent of the test is always to use an isolated SQLite file.
//
// resolveDbBackend accepts an explicit env param so we can exercise both branches
// without spawning a child process or touching process.env.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDbBackend } from "../db-path.ts";

test("resolveDbBackend returns sqlite when no backend is configured", () => {
  assert.equal(resolveDbBackend({}), "sqlite");
});

test("resolveDbBackend returns sqlite when KP_DB_BACKEND=sqlite", () => {
  assert.equal(resolveDbBackend({ KP_DB_BACKEND: "sqlite" }), "sqlite");
});

// "resolveDbBackend throws for Postgres in a production env" cannot be tested in-process:
// process.execArgv always contains --test when run via `npm run test:unit`, so inTestRun()
// returns true regardless of the env param, and the throw branch is unreachable here.
// The throw path is exercised by its error message assertion in db-test-isolation-guard.test.ts
// (the child sets NODE_TEST_CONTEXT so the positive-path openStore() works, but its sibling
// test for the DEFAULT db path verifies the message via a child process in a non-test cwd).

test("resolveDbBackend returns sqlite for Postgres config when NODE_TEST_CONTEXT is set", () => {
  assert.equal(resolveDbBackend({ KP_DB_BACKEND: "postgres", NODE_TEST_CONTEXT: "child-v8" }), "sqlite");
});

test("resolveDbBackend returns sqlite for postgres:// DATABASE_URL when NODE_TEST_CONTEXT is set", () => {
  assert.equal(resolveDbBackend({ DATABASE_URL: "postgresql://localhost/mydb", NODE_TEST_CONTEXT: "child-v8" }), "sqlite");
});

test("resolveDbBackend returns sqlite for Postgres config when NODE_ENV=test", () => {
  assert.equal(resolveDbBackend({ KP_DB_BACKEND: "postgres", NODE_ENV: "test" }), "sqlite");
});
