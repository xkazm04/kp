// Tenant-isolation for the pipeline events feed (P1). GET /api/pipeline/events
// backs the newest-page feed and the since-cursor catch-up. Before the fix the
// route omitted the workspace argument each DB function accepts, so it fell to
// DEFAULT_WORKSPACE_ID and a second tenant's feed read the wrong team's audit
// trail. (The route also once served an ungated per-entry drawer branch; that
// was removed — the drawer now uses the operator-gated [id]/timeline bundle.
// listPipelineEventsForEntry is still exercised here directly for its own
// workspace-isolation contract.)
//
// Two layers of proof, both under the default `npm run test:unit` runner (the
// route can't be driven behaviorally here — currentWorkspace() reads cookies()
// which throws outside a request, and module mocking needs a flag the runner
// doesn't pass):
//   1. BEHAVIORAL — all three reads, given a workspace, isolate by it.
//   2. SOURCE GUARD — the route actually threads the caller's workspace into
//      all three calls (the bug was purely the missing argument).
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store
// module resolves db-path.ts).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import {
  createPipelineEntry,
  actOnPipelineEntry,
  listPipelineEvents,
  listPipelineEventsSince,
  listPipelineEventsForEntry,
} from "../../../_lib/db/pipeline.ts";

after(() => cleanupUnitDb());

test("all three event reads (feed, since-cursor, per-entry) isolate by workspace", () => {
  // Two teams each file (and advance) a candidate — every step records an event
  // auto-tagged to that entry's workspace via recordEvent.
  const a = createPipelineEntry({ candidateId: "ev-a", candidateLabel: "Alice A", jobId: "jobA", jobTitle: "Role A", workspaceId: "ws-a" });
  const b = createPipelineEntry({ candidateId: "ev-b", candidateLabel: "Bob B", jobId: "jobB", jobTitle: "Role B", workspaceId: "ws-b" });
  actOnPipelineEntry(a.entry.id, "accept", undefined, undefined, "ws-a");
  actOnPipelineEntry(b.entry.id, "accept", undefined, undefined, "ws-b");

  // Newest-page feed (the Activity feed's initial page).
  const feedA = new Set(listPipelineEvents(40, 0, undefined, "ws-a").map((e) => e.jobTitle));
  assert.ok(feedA.has("Role A") && !feedA.has("Role B"), "ws-a feed is ws-a-only");
  const feedB = new Set(listPipelineEvents(40, 0, undefined, "ws-b").map((e) => e.jobTitle));
  assert.ok(feedB.has("Role B") && !feedB.has("Role A"), "ws-b feed is ws-b-only");

  // Since-cursor catch-up (poll from the very start, id > 0).
  const sinceA = new Set(listPipelineEventsSince(0, 200, "ws-a").map((e) => e.jobTitle));
  assert.ok(sinceA.has("Role A") && !sinceA.has("Role B"), "ws-a since-cursor is ws-a-only");
  const sinceB = new Set(listPipelineEventsSince(0, 200, "ws-b").map((e) => e.jobTitle));
  assert.ok(sinceB.has("Role B") && !sinceB.has("Role A"), "ws-b since-cursor is ws-b-only");

  // Per-entry drawer history — a cross-team read of another team's entry id is empty.
  assert.ok(listPipelineEventsForEntry(a.entry.id, 50, "ws-a").length >= 1, "ws-a reads its own drawer history");
  assert.equal(listPipelineEventsForEntry(a.entry.id, 50, "ws-b").length, 0, "ws-b cannot read ws-a's drawer history");
});

test("the events route threads the caller's workspace into its reads and no longer serves the ungated per-entry branch (bug-fix guard)", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(dir, "route.ts"), "utf8");
  // The route resolves the caller's tenant once...
  assert.match(src, /currentWorkspace\(\)/, "the route must resolve currentWorkspace()");
  // ...and passes it (as `ws`) to each remaining read — a bare call with no
  // workspace argument would silently fall to DEFAULT_WORKSPACE_ID again.
  assert.match(src, /listPipelineEventsSince\([^)]*\bws\b[^)]*\)/, "since-cursor read must be workspace-scoped");
  assert.match(src, /listPipelineEvents\([^)]*\bws\b[^)]*\)/, "feed read must be workspace-scoped");
  // The `?entry=` branch served full un-anonymized recruiter PII with NO
  // requireOperator() gate (the sibling [id]/timeline routes are gated). It was
  // dead code and is removed; if it ever comes back it MUST be operator-gated.
  assert.doesNotMatch(src, /listPipelineEventsForEntry/, "the ungated per-entry branch must stay removed (gate with requireOperator if reintroduced)");
});
