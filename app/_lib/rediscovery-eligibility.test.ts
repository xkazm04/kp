// ONE person-level eligibility gate for rediscovery (challenge-r08 candidate-rediscovery/A).
//
// "May this person be surfaced for a role they never applied to?" used to be answered
// three ways: the rank gate composed consent + opt-out inline, the alert write wall
// checked consent only, and the feed read checked neither. `withheldCandidateIds` is
// now the single predicate, and every door reads it: the rank-time pool filter
// (rediscoverForJob), the alert write + reconcile wall (rediscovery-alert-store), the
// feed read (liveRediscoveryAlerts, behind GET/POST /api/rediscovery/alerts and its
// `count`), the Reach-out send door (/api/jobs/[id]/candidates/outreach), and the
// board-add door on a rediscovery/sourcing re-surface (/api/pipeline).
//
// Runner: node:test with type stripping — `npm run test:unit`.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Throwaway DB — MUST stay the first project import (db-path freezes KP_DB_PATH).
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { anonymizeEntry, createPipelineEntry, recordEntryConsent } from "./db/pipeline.ts";
import { recordCandidateOptOut } from "./outreach-state-store.ts";
import { withheldCandidateIds } from "./rediscovery-eligibility.ts";

after(() => cleanupUnitDb());

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(here, rel), "utf8").replace(/\r\n/g, "\n");

/** The person's ORIGINAL entry under another role. */
const entryFor = (candidateId: string) =>
  createPipelineEntry({ candidateId, candidateLabel: `Person ${candidateId}`, jobId: "elig-roleX", jobTitle: "Role X" }).entry;

test("withheldCandidateIds names every reason a person may not be surfaced, and only those", () => {
  // An opt-out recorded on ANY of the person's entries withholds the person.
  entryFor("elig-halted");
  const second = createPipelineEntry({
    candidateId: "elig-halted",
    candidateLabel: "Person elig-halted",
    jobId: "elig-roleW",
    jobTitle: "Role W",
  }).entry;
  recordCandidateOptOut(second.id);

  anonymizeEntry(entryFor("elig-anon").id, "erasure");
  recordEntryConsent(entryFor("elig-lapsed").id, "apply", -400);
  entryFor("elig-sourced"); // recruiter-sourced: an entry, no consent record, no halt

  const out = withheldCandidateIds(["elig-halted", "elig-anon", "elig-lapsed", "elig-sourced", "elig-never-seen", "", null]);
  assert.equal(out.get("elig-halted"), "opted_out");
  assert.equal(out.get("elig-anon"), "anonymized");
  assert.equal(out.get("elig-lapsed"), "consent_expired");
  assert.equal(out.has("elig-sourced"), false, "recruiter-sourced with no halt is contactable");
  assert.equal(out.has("elig-never-seen"), false, "an id with no entry anywhere is contactable");
  assert.equal(out.size, 3, "blank/nullish ids are dropped, not reported");
});

test("an erased person who also opted out reads as anonymized (erasure is terminal)", () => {
  const e = entryFor("elig-both");
  recordCandidateOptOut(e.id);
  anonymizeEntry(e.id, "erasure");
  assert.equal(withheldCandidateIds(["elig-both"]).get("elig-both"), "anonymized");
});

test("source guard: rank, write, read and send all run the SAME predicate", () => {
  const rediscover = read("rediscover.ts");
  const route = read("../api/rediscovery/alerts/route.ts");
  const outreach = read("../api/jobs/[id]/candidates/outreach/route.ts");
  const store = read("rediscovery-alert-store.ts");

  // Rank + feed read: rediscover.ts imports the gate from the one module.
  assert.match(rediscover, /import \{[^}]*\bwithheldCandidateIds\b[^}]*\} from "\.\/rediscovery-eligibility"/);
  assert.doesNotMatch(rediscover, /\bsuppressedCandidateIds\(|\boptedOutCandidateIds\(/, "no inline half-gate in rediscover.ts");
  assert.match(rediscover, /withheldCandidateIds\(pool\.map/, "the rank-time pool filter reads the gate");
  assert.match(
    rediscover,
    /export function liveRediscoveryAlerts[\s\S]*?withheldCandidateIds\(/,
    "the feed read refilters through the gate"
  );

  // The feed route reads ONLY through liveRediscoveryAlerts — never the raw list, never a half-gate.
  assert.doesNotMatch(route, /\bsuppressedCandidateIds\b|\boptedOutCandidateIds\b/);
  assert.doesNotMatch(route, /\blistRediscoveryAlerts\(/, "the raw list must not reach the wire");
  assert.match(route, /liveRediscoveryAlerts\(await currentWorkspace\(\)\)/, "GET reads the gated projection");
  assert.match(route, /liveRediscoveryAlerts\(ws\)/, "POST returns the gated projection");

  // The Reach-out send door reads the same gate, not the two halves.
  assert.match(outreach, /import \{[^}]*\bwithheldCandidateIds\b[^}]*\} from "@\/app\/_lib\/rediscovery-eligibility"/);
  assert.doesNotMatch(outreach, /\bcandidateOutreachSuppression\(|\boptedOutCandidateIds\(/);

  // The board-add door gates a re-surface add (source rediscovery/sourcing) on the same
  // gate; its behaviour is pinned in app/api/pipeline/add-eligibility.test.ts.
  const boardAdd = read("../api/pipeline/route.ts");
  assert.match(boardAdd, /import \{[^}]*\bwithheldCandidateIds\b[^}]*\} from "@\/app\/_lib\/rediscovery-eligibility"/);
  assert.doesNotMatch(boardAdd, /\bsuppressedCandidateIds\(|\boptedOutCandidateIds\(/);

  // The store's write wall + reconcile read the same definition (no consent-only wall).
  assert.match(store, /export function withheldCandidateIds/);
  const walls = store.match(/withheldCandidateIds\(/g) ?? [];
  assert.ok(walls.length >= 3, "definition + record wall + reconcile wall");
});
