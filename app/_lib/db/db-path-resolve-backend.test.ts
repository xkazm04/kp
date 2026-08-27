// Regression: resolveDbBackend must not throw in test runs even when DATABASE_URL is a
// postgres URL. The fail-fast postgres check is for production/dev (where an operator
// might have misconfigured DATABASE_URL); test runs ALWAYS use SQLite, and path safety
// is enforced by assertTestDbIsolated(). Without this, any test that reaches openStore()
// fails the moment DATABASE_URL is present in the environment (e.g. CI or a local dev
// env that also runs Supabase).
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDbBackend } from "../db-path.ts";

test("resolveDbBackend returns 'sqlite' in a test run even when DATABASE_URL is postgres", () => {
  const result = resolveDbBackend({
    NODE_TEST_CONTEXT: "child-v8",
    DATABASE_URL: "postgresql://user:pass@host:5432/db",
  });
  assert.equal(result, "sqlite");
});
