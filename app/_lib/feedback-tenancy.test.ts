// Behavioral pins for the recruiter feedback door against an ISOLATED throwaway
// SQLite file (unit-db.ts MUST stay the first project import — KP_DB_PATH is
// frozen at db-path's module load). Three invariants a regression would
// silently break:
//   1. MIGRATION (the core-migrations.test.ts convention): a fresh ensureDb()
//      creates the `feedback` table with every column + its workspace index;
//   2. round-trip: a validated submission is stored and read back newest-first;
//   3. TENANCY (the manifest's colocated *-tenancy.test.ts requirement): reads
//      filter and writes stamp workspace_id, so one team's feedback can never
//      surface in another team's operator view.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { ensureDb } from "./db/core.ts";
import { parseFeedbackSubmission, replyEmailFrom } from "./feedback.ts";
import { listFeedback, recordFeedback } from "./feedback-store.ts";

after(() => cleanupUnitDb());

test("migration pin: a fresh DB carries the feedback table, all columns, and the workspace index", () => {
  const db = ensureDb();
  const tables = new Set(
    (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name)
  );
  assert.ok(tables.has("feedback"), "fresh schema is missing the feedback table");
  const cols = new Set(
    (db.prepare(`PRAGMA table_info(feedback)`).all() as { name: string }[]).map((r) => r.name)
  );
  for (const col of ["id", "message", "email", "route", "app_version", "workspace_id", "created_at"]) {
    assert.ok(cols.has(col), `feedback is missing column "${col}"`);
  }
  const indexes = new Set(
    (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'feedback'`).all() as {
      name: string;
    }[]).map((r) => r.name)
  );
  assert.ok(indexes.has("idx_feedback_ws"), "idx_feedback_ws is missing");
});

test("a validated submission round-trips and lists newest-first", () => {
  const first = parseFeedbackSubmission({ message: "The pipeline board is great", route: "/?tab=pipeline" });
  const second = parseFeedbackSubmission({ message: "Second note", route: "not-a-path" });
  assert.ok(first.ok && second.ok);
  // The reply address is stamped by the ROUTE from the session user, never parsed
  // out of the body — recordFeedback takes it as its own field.
  recordFeedback({ ...first.value, email: replyEmailFrom("a@b.cz"), appVersion: "0.1.0" });
  recordFeedback({ ...second.value, email: null, appVersion: null });
  const rows = listFeedback();
  assert.ok(rows.length >= 2);
  assert.equal(rows[0].message, "Second note");
  assert.equal(rows[0].email, null, "empty email must normalize to null");
  assert.equal(rows[0].route, null, "a non-path route must be dropped to null");
  assert.equal(rows[1].message, "The pipeline board is great");
  assert.equal(rows[1].email, "a@b.cz");
  assert.equal(rows[1].route, "/?tab=pipeline");
  assert.equal(rows[1].appVersion, "0.1.0");
});

test("tenancy: reads filter and writes stamp workspace_id — no cross-tenant leak", () => {
  const sub = parseFeedbackSubmission({ message: "Beta team private note" });
  assert.ok(sub.ok);
  recordFeedback({ ...sub.value, email: null, appVersion: null }, "team-beta");
  const beta = listFeedback(50, "team-beta");
  assert.equal(beta.length, 1, "team-beta must see exactly its own row");
  assert.equal(beta[0].message, "Beta team private note");
  assert.ok(
    listFeedback(50).every((r) => r.message !== "Beta team private note"),
    "the default workspace must never see team-beta's feedback"
  );
});

test("validation refuses instead of coercing", () => {
  assert.equal(parseFeedbackSubmission({}).ok, false);
  assert.equal(parseFeedbackSubmission({ message: "   " }).ok, false);
  assert.equal(parseFeedbackSubmission({ message: "x".repeat(2001) }).ok, false);
  // A body-supplied address is IGNORED, not honoured: identity comes from the
  // session, so a spoofed "email" field must never reach the stored row.
  const spoofed = parseFeedbackSubmission({ message: "ok", email: "someone.else@corp.example" });
  assert.ok(spoofed.ok && !("email" in spoofed.value), "the parser must not carry a client-supplied email");
  // …and the server-side normaliser drops anything undeliverable rather than storing it.
  assert.equal(replyEmailFrom("not-an-email"), null);
  assert.equal(replyEmailFrom("  "), null);
  assert.equal(replyEmailFrom(null), null);
  assert.equal(replyEmailFrom("a@b.cz"), "a@b.cz");
  const dropped = parseFeedbackSubmission({ message: "ok", route: "https://evil.example/phish" });
  assert.ok(dropped.ok && dropped.value.route === null, "an absolute URL must not be stored as a route");
  const protocolRelative = parseFeedbackSubmission({ message: "ok", route: "//evil.example" });
  assert.ok(protocolRelative.ok && protocolRelative.value.route === null);
});
