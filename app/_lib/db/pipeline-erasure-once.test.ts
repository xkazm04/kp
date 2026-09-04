// An erasure happens EXACTLY ONCE, however many doors ask for it.
//
// Two callers reach anonymizeEntry: the consent-expiry sweep
// (anonymizeExpiredConsents, on the instrumentation heartbeat) and the candidate's own
// /data/[token] request. Idempotence was guarded by a READ — "if (row.anonymized_at)
// return" — on a DEFERRED transaction, which is not idempotence at all: the transaction
// took no write lock while it computed, so both callers could pass the read before
// either wrote. The second pass then
//
//   • masked an ALREADY-MASKED label (maskCandidateName of "First L." — a mask on a mask),
//   • re-ran the entire linked-PII scrub, and
//   • logged a SECOND consent event,
//
// so the Art. 5(2) accountability record showed one candidate erased twice and the sweep
// counted a row it had not scrubbed.
//
// The fix is both halves of the house rule: `.immediate()` (write lock at BEGIN) plus a
// claiming UPDATE that re-asserts `anonymized_at IS NULL` with a `changes === 0` early
// return, for a writer on a second connection. This file pins the OBSERVABLE
// consequence — one erasure, one consent event, a stable mask — rather than the SQL, so
// it stays true if the strategy is ever re-picked.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH so every store opens a
// throwaway SQLite file unique to this process).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  anonymizeEntry,
  createPipelineEntry,
  getPipelineEntry,
  listConsentEvents,
  recordEntryConsent,
} from "./pipeline.ts";

after(() => cleanupUnitDb());

/** The consent-trail rows an erasure writes ("erased" / "anonymized"), which is the
 *  record a duplicate pass corrupted. */
function erasureEvents(entryId: string): string[] {
  return listConsentEvents(entryId)
    .map((e) => e.kind)
    .filter((k) => k === "erased" || k === "anonymized");
}

test("two erasures on one entry record ONE consent event and leave one stable mask", () => {
  const entry = createPipelineEntry({
    candidateId: "erase-cand-1",
    candidateLabel: "Jan Novák",
    jobId: "erase-job-1",
    jobTitle: "Backend Eng",
    stage: "Screened",
    contact: "jan@example.test",
  }).entry;
  recordEntryConsent(entry.id, "apply");

  // Door 1 — the candidate's own /data/[token] request.
  const first = anonymizeEntry(entry.id, "erasure");
  assert.ok(first, "the first erasure returns the scrubbed entry");
  assert.ok(first!.anonymizedAt, "anonymized_at is stamped");
  const maskAfterFirst = first!.candidateLabel;
  assert.notEqual(maskAfterFirst, "Jan Novák", "the label is masked");
  assert.equal(getPipelineEntry(entry.id)!.contact, null, "contact is nulled");

  // Door 2 — the consent-expiry sweep arriving on the same entry.
  const second = anonymizeEntry(entry.id, "expiry");
  assert.ok(second, "the second call still answers truthfully: this entry IS erased");

  assert.equal(
    second!.candidateLabel,
    maskAfterFirst,
    "the mask must be STABLE — a second pass must not mask the mask (maskCandidateName of 'First L.')"
  );
  assert.deepEqual(
    erasureEvents(entry.id),
    ["erased"],
    "exactly ONE erasure event in the accountability trail — a duplicate is a compliance-record defect, not a cosmetic one"
  );
  assert.equal(second!.anonymizedAt, first!.anonymizedAt, "the erasure timestamp is the FIRST one, not overwritten");
});

test("a third and fourth pass change nothing further", () => {
  const entry = createPipelineEntry({
    candidateId: "erase-cand-2",
    candidateLabel: "Marie Dvořáková",
    jobId: "erase-job-2",
    jobTitle: "Data Eng",
    stage: "Interview",
    contact: "marie@example.test",
  }).entry;
  recordEntryConsent(entry.id, "apply");

  const first = anonymizeEntry(entry.id, "expiry")!;
  for (let i = 0; i < 3; i += 1) anonymizeEntry(entry.id, "erasure");

  assert.equal(getPipelineEntry(entry.id)!.candidateLabel, first.candidateLabel);
  assert.deepEqual(erasureEvents(entry.id), ["anonymized"], "still one event after four calls");
});

// ── The strategy is DECLARED, not incidental ──────────────────────────────────
//
// The behavioural tests above pass on a single connection even with a bare read guard,
// because better-sqlite3 is synchronous and this process cannot interleave itself. The
// window is real for a SECOND connection (a request handler beside the heartbeat), and
// what closes it is the pair of choices below. Pinning them at the source keeps a future
// refactor from quietly dropping to the read-only guard that shipped the duplicate.
const SOURCE = readFileSync(fileURLToPath(new URL("./pipeline.ts", import.meta.url)), "utf8");

function functionBody(name: string): string {
  const start = SOURCE.indexOf(`export function ${name}(`);
  assert.notEqual(start, -1, `${name} not found — did it get renamed?`);
  const rest = SOURCE.slice(start + 1);
  const end = rest.indexOf("\nexport ");
  return end === -1 ? rest : rest.slice(0, end);
}

test("anonymizeEntry takes the write lock at BEGIN and re-asserts the guard it read", () => {
  const body = functionBody("anonymizeEntry");
  assert.match(
    body,
    /return tx\.immediate\(\)/,
    "anonymizeEntry must run .immediate() — a read→compute→write either locks or re-checks, and this one does both"
  );
  assert.match(
    body,
    /anonymized_at IS NULL/,
    "the claiming UPDATE must re-assert anonymized_at IS NULL — the read alone is not idempotence across connections"
  );
  assert.match(
    body,
    /changes === 0/,
    "a claim that matched nothing must return early rather than re-run the scrub and log a second consent event"
  );
});
