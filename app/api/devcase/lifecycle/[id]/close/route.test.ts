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
import { createPipelineEntry } from "../../../../../_lib/db/pipeline.ts";
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

test("close never sends a rejection to a submitter already promoted to the pipeline", async () => {
  // Promotion is recorded as a pipeline entry linked by dev_submission_id — nothing in
  // the store writes a submission status of "promoted", so the old status check skipped
  // nobody: every candidate who had just received the "Next step" letter was then sent
  // "we won't be moving forward". The pipeline owns a promoted candidate's comms.
  const lc = createLifecycle({ title: "Backend role" }, false);
  const dc = saveDevCase({ need: {}, analysis: {}, role: { title: "Backend Engineer" }, case: { title: "API case" } });
  updateLifecycle(lc.id, { caseId: dc.id, stage: "promoted" });
  const posting = createPosting({ caseId: dc.id, channel: "link", token: `tok-${dc.id}`, roleTitle: "Backend Engineer", caseTitle: "API case" });
  const promoted = createSubmission({ postingId: posting.id, candidateRef: "promoted-pat", repoRef: "repo-p", contact: "pat@example.test" });
  createSubmission({ postingId: posting.id, candidateRef: "passed-over-quinn", repoRef: "repo-q", contact: "quinn@example.test" });
  createPipelineEntry({ candidateId: "profile-pat", candidateLabel: "Pat", jobId: "jd-backend", jobTitle: "Backend Engineer", devCaseId: dc.id, devSubmissionId: promoted.submission.id });

  const before = new Set(listOutboxFiltered({ kind: "rejection" }).map((row) => row.id));
  const res = await POST(req(lc.id), ctx(lc.id));
  assert.equal(res.status, 200);
  const sent = listOutboxFiltered({ kind: "rejection" }).filter((row) => !before.has(row.id));
  assert.deepEqual(sent.map((row) => row.recipient), ["quinn@example.test"], "only the submitter who was not promoted is told no");
});

test("close skips opaque candidate handles but uses an email ref when contact is absent", async () => {
  const lc = createLifecycle({ title: "Backend role" }, false);
  const dc = saveDevCase({ need: {}, analysis: {}, role: { title: "Backend Engineer" }, case: { title: "API case" } });
  updateLifecycle(lc.id, { caseId: dc.id, stage: "promoted" });
  const posting = createPosting({ caseId: dc.id, channel: "link", token: `tok-${dc.id}`, roleTitle: "Backend Engineer", caseTitle: "API case" });
  createSubmission({ postingId: posting.id, candidateRef: "opaque-123", repoRef: "repo-opaque" });
  createSubmission({ postingId: posting.id, candidateRef: "ref@example.test", repoRef: "repo-email" });

  const before = new Set(listOutboxFiltered({ kind: "rejection" }).map((row) => row.id));
  const res = await POST(req(lc.id), ctx(lc.id));
  assert.equal(res.status, 200);
  assert.equal((await res.json() as { notified: number }).notified, 1);
  const sent = listOutboxFiltered({ kind: "rejection" }).filter((row) => !before.has(row.id));
  assert.deepEqual(sent.map((row) => row.recipient), ["ref@example.test"]);
  assert.equal(getLifecycle(lc.id)?.stage, "closed");
});
