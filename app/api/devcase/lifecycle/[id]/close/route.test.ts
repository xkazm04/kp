// Behavioral, real-DB test for the human-gated case close-out
// (bug-ui-scan-2026-07-09 #1 — close-case TOCTOU race).
//
// unit-db.ts is the FIRST project import: it sets KP_DB_PATH before any module
// touches db-path.ts, so every store below opens a throwaway isolated SQLite file
// for this process (not the developer's data/kp.sqlite).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../../../../../_lib/testing/unit-db.ts";
import {
  createLifecycle,
  saveDevCase,
  updateLifecycle,
  createPosting,
  createSubmission,
  getLifecycle,
  listOutboxFiltered,
  claimLifecycleClose,
} from "../../../../../_lib/db.ts";
import { listAudit } from "../../../../../_lib/dev-control.ts";
import { POST } from "./route.ts";

after(() => cleanupUnitDb());

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (id: string) => new Request(`http://localhost/api/devcase/lifecycle/${id}/close`, { method: "POST" });

// One non-closed lifecycle linked (by caseId) to a posting carrying N
// non-promoted submitters — every one is owed exactly one wrap-up rejection.
function seed(candidateRefs: string[]): string {
  const lc = createLifecycle({ title: "Backend role" }, false);
  const dc = saveDevCase({ need: {}, analysis: {}, role: { title: "Backend Engineer" }, case: { title: "API case" } });
  updateLifecycle(lc.id, { caseId: dc.id, stage: "promoted" });
  const posting = createPosting({ caseId: dc.id, channel: "link", token: `tok-${dc.id}`, roleTitle: "Backend Engineer", caseTitle: "API case" });
  for (const ref of candidateRefs) {
    createSubmission({ postingId: posting.id, candidateRef: ref, repoRef: `repo-${ref}`, contact: `${ref}@example.test` });
  }
  return lc.id;
}

test("claimLifecycleClose is a compare-and-set: only the first caller flips the stage", () => {
  const id = seed([]);
  assert.equal(claimLifecycleClose(id), true, "first close claims the stage (changes === 1)");
  assert.equal(getLifecycle(id)!.stage, "closed");
  assert.equal(claimLifecycleClose(id), false, "second close finds it already closed and no-ops (changes === 0)");
});

test("two overlapping closes send exactly ONE rejection batch (no doubled adverse-action comms)", async () => {
  const refs = ["ada", "grace", "linus"];
  const id = seed(refs);

  // The race: a double-click across two tabs / a retry / two teammates closing at
  // once. Drive the REAL route twice concurrently — both start before either has
  // written the terminal stage.
  const [a, b] = await Promise.all([POST(req(id), ctx(id)), POST(req(id), ctx(id))]);
  const bodyA = (await a.json()) as { notified?: number; alreadyClosed?: boolean };
  const bodyB = (await b.json()) as { notified?: number; alreadyClosed?: boolean };

  // Exactly one request owned the close (notified everyone); the other no-opped.
  const owned = [bodyA, bodyB].filter((x) => x.notified === refs.length);
  const noop = [bodyA, bodyB].filter((x) => x.alreadyClosed === true);
  assert.equal(owned.length, 1, "exactly one request performs the close + notify");
  assert.equal(noop.length, 1, "the other request short-circuits as alreadyClosed");

  // THE INVARIANT. One rejection per candidate — never two. Against the pre-fix code
  // each concurrent request sent its OWN full batch (the dedup Set is per-request),
  // so this count was 2 * refs.length and both asserts above also broke.
  const rejections = listOutboxFiltered({ kind: "rejection" });
  assert.equal(rejections.length, refs.length, `exactly ${refs.length} rejection notes total, not doubled`);
  assert.equal(new Set(rejections.map((r) => r.recipient)).size, refs.length, "each candidate messaged exactly once");

  // ...and exactly one terminal audit row for this close (the finding also flagged
  // "two closed audit rows are written").
  const closedAudits = listAudit().filter((e) => e.action === "closed" && e.lifecycleId === id);
  assert.equal(closedAudits.length, 1, "exactly one 'closed' audit row");
  assert.equal(getLifecycle(id)!.stage, "closed");
});
