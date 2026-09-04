// The apply funnel's denominator store had NO behavioural test. Everything about
// it is a claim its own doc comment makes and nothing checked: that a re-POSTed
// start id does not inflate the count, that the back-link fires once and only onto
// an unlinked row, and — new here — that abandoned attempts are actually swept.
//
// unit-db.ts must stay the first project import (isolated throwaway DB), and the
// data layer is imported as SLICES, never through app/_lib/db.ts.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import Database from "better-sqlite3";
import { openStore } from "./db-path.ts";
import { linkApplySession, startApplySession, sweepAbandonedApplySessions } from "./apply-session-store.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";

after(() => cleanupUnitDb());

/** A second handle on the same file — the store deliberately owns a private
 *  connection and exposes no reader for the row itself, so the assertions read the
 *  table directly rather than through an API written for the test. */
const raw: Database.Database = openStore();
const row = (id: string) =>
  raw.prepare(`SELECT * FROM apply_sessions WHERE id = ?`).get(id) as
    | { id: string; job_id: string; flow: string; started_at: string; entry_id: string | null; campaign: string | null; workspace_id: string }
    | undefined;
/** Backdate an attempt so a window-bounded sweep can see it, without waiting. */
const backdate = (id: string, days: number) =>
  raw.prepare(`UPDATE apply_sessions SET started_at = datetime('now', ?) WHERE id = ?`).run(`-${days} days`, id);

test("a re-POSTed start id is ignored, never counted twice or thrown", () => {
  startApplySession({ id: "sess-idem", jobId: "job-a", flow: "chat", campaign: "spring", workspaceId: DEFAULT_WORKSPACE_ID });
  const first = row("sess-idem");
  assert.equal(first?.flow, "chat");
  assert.equal(first?.campaign, "spring");

  // The client keeps the id in localStorage and re-sends it after a reload. That
  // must not inflate the denominator — and must not error either, since the client
  // fires this and forgets.
  startApplySession({ id: "sess-idem", jobId: "job-a", flow: "quick", campaign: "autumn", workspaceId: DEFAULT_WORKSPACE_ID });
  const second = row("sess-idem");
  assert.equal(second?.flow, "chat", "the FIRST start wins — a repeat is ignored, not an update");
  assert.equal(second?.campaign, "spring");
  assert.equal(second?.started_at, first?.started_at, "the reload must not restart the attempt's clock");
});

test("the back-link fires once, and only onto an attempt that is still unlinked", () => {
  startApplySession({ id: "sess-link", jobId: "job-a", flow: "quick" });
  linkApplySession("sess-link", "entry-1");
  assert.equal(row("sess-link")?.entry_id, "entry-1");

  // A second submission on the same attempt (a retry whose first response was lost,
  // or a re-apply that merged) must not re-point the row at a different entry: the
  // attempt became THAT application, and rewriting it would move the funnel credit.
  linkApplySession("sess-link", "entry-2");
  assert.equal(row("sess-link")?.entry_id, "entry-1", "the link is write-once");

  // No session id (localStorage unavailable) is a no-op, not a crash: the
  // application has already been filed by the time this runs.
  assert.doesNotThrow(() => linkApplySession(null, "entry-3"));
  assert.doesNotThrow(() => linkApplySession(undefined, "entry-3"));
  // An id nobody started is also a no-op — a scripted or stale value grants nothing.
  assert.doesNotThrow(() => linkApplySession("sess-never-started", "entry-3"));
  assert.equal(row("sess-never-started"), undefined, "a bogus id must not conjure a row");
});

test("the retention sweep removes ONLY the orphans past the window", () => {
  startApplySession({ id: "sweep-old-orphan", jobId: "job-s", flow: "chat" });
  startApplySession({ id: "sweep-old-filed", jobId: "job-s", flow: "chat" });
  startApplySession({ id: "sweep-fresh-orphan", jobId: "job-s", flow: "quick" });
  linkApplySession("sweep-old-filed", "entry-filed");
  backdate("sweep-old-orphan", 200);
  backdate("sweep-old-filed", 200);

  const removed = sweepAbandonedApplySessions(180);
  assert.ok(removed >= 1, "the aged abandonment must be swept");
  assert.equal(row("sweep-old-orphan"), undefined, "an aged attempt that never filed is deleted");
  assert.ok(row("sweep-old-filed"), "an attempt that reached a filed entry is provenance — never swept");
  assert.ok(row("sweep-fresh-orphan"), "an attempt inside the window may still be someone mid-application");

  // Idempotent: a second pass over the same table finds nothing left to do, so a
  // clock that ticks every minute does no work and writes no log line.
  assert.equal(sweepAbandonedApplySessions(180), 0);
});

test("the sweep can be bounded to one workspace, and the clock's unbounded call is the whole deployment", () => {
  startApplySession({ id: "sweep-ws-a", jobId: "job-w", flow: "chat", workspaceId: "team-a" });
  startApplySession({ id: "sweep-ws-b", jobId: "job-w", flow: "chat", workspaceId: "team-b" });
  backdate("sweep-ws-a", 400);
  backdate("sweep-ws-b", 400);

  assert.equal(sweepAbandonedApplySessions(365, "team-a"), 1);
  assert.equal(row("sweep-ws-a"), undefined);
  assert.ok(row("sweep-ws-b"), "the scoped sweep must not reach into another team's rows");

  // No workspace = every tenant, which is what the heartbeat calls: retention is a
  // deployment-wide duty and a per-tenant loop would leave any workspace nobody
  // enumerated growing forever.
  assert.equal(sweepAbandonedApplySessions(365), 1);
  assert.equal(row("sweep-ws-b"), undefined);
});
