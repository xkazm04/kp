// Rediscovery honors consent at RANK time, and its alerts do not accrue forever.
//
// Consent used to gate rediscovery at ONE door — the "Reach out" send in
// /api/candidates/[id]/outreach. Everything before it ran on the whole pool: an
// anonymized (Art. 17 erased) or lapsed-consent person was still ranked, still
// persisted as a `rediscovery_alerts` row carrying their LABEL, and still rendered
// in the standing feed and the Rediscover panel. The predicate that would have
// excluded them (candidateOutreachSuppression) lived in the very module that writes
// the row and was never called there. So an erasure removed the person's data from
// the pipeline and rediscovery put their name straight back on a shared screen.
//
// These pin the two walls that close it — the pool filter before the ranking, and
// the write refusal in the store — plus the retention sweep that stops dismissed
// and un-acted-on alerts accumulating indefinitely.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Database from "better-sqlite3";

// Point every store connection at a throwaway DB BEFORE importing them: db-path reads
// KP_DB_PATH at module load (DB_PATH is frozen then), so this MUST stay the first
// project import.
import { cleanupUnitDb, UNIT_DB_PATH as TMP } from "./testing/unit-db.ts";
import { anonymizeEntry, createPipelineEntry, recordEntryConsent } from "./db/pipeline.ts";
import {
  ALERT_DISMISSED_RETENTION_DAYS,
  ALERT_STALE_RETENTION_DAYS,
  dismissRediscoveryAlert,
  listRediscoveryAlerts,
  pruneRediscoveryAlerts,
  recordRediscoveryAlerts,
  suppressedCandidateIds,
} from "./rediscovery-alert-store.ts";

after(() => cleanupUnitDb());

const DAY_MS = 24 * 60 * 60 * 1000;

const alertFor = (candidateId: string) => ({
  candidateId,
  label: `Named Person ${candidateId}`,
  archetype: "bau",
  score: 82,
  prior: { kind: "rejected", label: "Rejected · Beta Role", stage: "Interview", depth: 2 },
});

/** The candidate's ORIGINAL entry under another role — the one carrying their real
 *  consent lifecycle. Rediscovery ranks them for a DIFFERENT role. */
const originalEntry = (candidateId: string, label: string) =>
  createPipelineEntry({ candidateId, candidateLabel: label, jobId: "roleX", jobTitle: "Role X" }).entry;

// ---- the write wall: an unconsented person never becomes an alert row -------

test("a LAPSED-consent person never becomes a rediscovery alert row", () => {
  const cand = "rank-expired";
  const x = originalEntry(cand, "Expired Person");
  recordEntryConsent(x.id, "apply", -400); // granted, but already lapsed

  // Non-vacuity: the gate itself must actually see this person as suppressed.
  assert.equal(suppressedCandidateIds([cand]).get(cand), "consent_expired");

  const added = recordRediscoveryAlerts("roleY", "Role Y", [alertFor(cand)]);
  assert.equal(added, 0, "a lapsed-consent candidate must not be persisted as an alert");
  assert.equal(
    listRediscoveryAlerts().some((a) => a.candidateId === cand),
    false,
    "…and must not appear in the standing feed under any label"
  );
});

test("an ANONYMIZED (erased) person never becomes a rediscovery alert row", () => {
  const cand = "rank-anon";
  const x = originalEntry(cand, "Scrubbed Person");
  anonymizeEntry(x.id, "erasure"); // Art.17

  assert.equal(suppressedCandidateIds([cand]).get(cand), "anonymized");
  assert.equal(recordRediscoveryAlerts("roleY", "Role Y", [alertFor(cand)]), 0);
  assert.equal(listRediscoveryAlerts().some((a) => a.candidateId === cand), false);
});

test("a consenting person is still recorded, and a mixed batch drops ONLY the suppressed", () => {
  const ok = "rank-valid";
  const bad = "rank-valid-lapsed";
  recordEntryConsent(originalEntry(ok, "Valid Person").id, "apply", 365);
  recordEntryConsent(originalEntry(bad, "Lapsed Person").id, "apply", -400);

  const added = recordRediscoveryAlerts("roleZ", "Role Z", [alertFor(ok), alertFor(bad)]);
  assert.equal(added, 1, "the consenting candidate is still surfaced — no over-suppression");
  const forRoleZ = listRediscoveryAlerts().filter((a) => a.jobId === "roleZ");
  assert.deepEqual(
    forRoleZ.map((a) => a.candidateId),
    [ok],
    "only the consenting candidate reaches the feed"
  );
});

test("suppressedCandidateIds reports only the suppressed — unknown and contactable ids are absent", () => {
  const sourced = "rank-sourced"; // an entry, but no consent record at all
  originalEntry(sourced, "Recruiter Sourced");
  const out = suppressedCandidateIds(["rank-expired", "rank-anon", sourced, "rank-never-seen", "", null]);
  assert.equal(out.get("rank-expired"), "consent_expired");
  assert.equal(out.get("rank-anon"), "anonymized");
  assert.equal(out.has(sourced), false, "no consent on file ⇒ recruiter-sourced ⇒ contactable");
  assert.equal(out.has("rank-never-seen"), false, "an id with no entry anywhere is contactable");
  assert.equal(out.size, 2, "blank/nullish ids are dropped, not reported as suppressed");
});

// ---- the rank wall: the pool is filtered BEFORE the ranking spawn -----------

test("rediscoverForJob filters the pool through the consent gate BEFORE ranking it", () => {
  // A source guard: rediscoverForJob's ranking is a Python subprocess, so the ORDER
  // (gate first, ranker second) cannot be observed from a unit test — but it is the
  // whole point. Ranking a suppressed person and dropping them afterwards would
  // still process their data for this purpose and still ship them to the CLI.
  // CRLF-normalized: this checkout is CRLF while the worktree may be LF.
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "rediscover.ts"), "utf8").replace(
    /\r\n/g,
    "\n"
  );
  const gateAt = src.indexOf("suppressedCandidateIds(pool.map");
  const rankAt = src.indexOf("await rankPoolForJob");
  assert.ok(gateAt > 0, "rediscoverForJob must resolve consent suppression over the pool");
  assert.ok(rankAt > 0, "…and still rank");
  assert.ok(gateAt < rankAt, "the consent gate must run BEFORE the ranking spawn, not after it");
  assert.match(
    src,
    /rankPoolForJob<\{[\s\S]*?\}>\(job\.id, eligible, job,/,
    "the ELIGIBLE pool is what gets ranked — never the raw pool"
  );
});

// ---- retention: alerts stop accruing forever -------------------------------

/** Backdate a row's timestamps directly — the windows are months long. */
function backdate(candidateId: string, cols: { createdAt?: string; dismissedAt?: string }) {
  const d = new Database(TMP);
  try {
    if (cols.createdAt) d.prepare(`UPDATE rediscovery_alerts SET created_at = ? WHERE candidate_id = ?`).run(cols.createdAt, candidateId);
    if (cols.dismissedAt) d.prepare(`UPDATE rediscovery_alerts SET dismissed_at = ? WHERE candidate_id = ?`).run(cols.dismissedAt, candidateId);
  } finally {
    d.close();
  }
}

test("the prune drops dismissed alerts past the window and stale un-acted-on ones, and keeps the rest", () => {
  const now = Date.now();
  const old = (days: number) => new Date(now - days * DAY_MS).toISOString();
  // Four rows in one role, each with no consent record (contactable) so the write
  // gate above is not what this test is measuring.
  const ids = ["prune-dismissed-old", "prune-dismissed-new", "prune-stale", "prune-fresh"];
  assert.equal(recordRediscoveryAlerts("rolePrune", "Role Prune", ids.map(alertFor)), 4);
  for (const id of ids) {
    const row = listRediscoveryAlerts().find((a) => a.candidateId === id);
    assert.ok(row, `${id} was recorded`);
  }
  // Dismiss two of them, then age everything.
  for (const id of ["prune-dismissed-old", "prune-dismissed-new"]) {
    const row = listRediscoveryAlerts().find((a) => a.candidateId === id)!;
    assert.equal(dismissRediscoveryAlert(row.id), true);
  }
  backdate("prune-dismissed-old", { dismissedAt: old(ALERT_DISMISSED_RETENTION_DAYS + 1) });
  backdate("prune-dismissed-new", { dismissedAt: old(ALERT_DISMISSED_RETENTION_DAYS - 1) });
  backdate("prune-stale", { createdAt: old(ALERT_STALE_RETENTION_DAYS + 1) });

  const { dismissed, stale } = pruneRediscoveryAlerts({ nowMs: now });
  assert.equal(dismissed, 1, "only the dismissed row past its window is dropped");
  assert.equal(stale, 1, "only the un-acted-on row past the stale window is dropped");

  const survivors = new Database(TMP);
  try {
    const rows = survivors
      .prepare(`SELECT candidate_id FROM rediscovery_alerts WHERE job_id = 'rolePrune' ORDER BY candidate_id`)
      .all() as { candidate_id: string }[];
    assert.deepEqual(
      rows.map((r) => r.candidate_id),
      ["prune-dismissed-new", "prune-fresh"],
      "a recently-dismissed row stays STICKY (so a re-sweep can't resurrect it) and a fresh one is untouched"
    );
  } finally {
    survivors.close();
  }
});

test("the prune is idempotent — a second pass over the same tree deletes nothing", () => {
  const again = pruneRediscoveryAlerts({ nowMs: Date.now() });
  assert.deepEqual(again, { dismissed: 0, stale: 0 });
});
