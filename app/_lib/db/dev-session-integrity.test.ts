// LLM-era controls #1 + #4 — tamper evidence on the observed session, END-TO-END.
//
// #1: every appended event carries a SERVER-computed hash-chain link; editing,
// deleting or re-timing a persisted row breaks recomputation and the integrity
// verdict flips to compromised — which the authenticity scorer treats as decisive.
// #4: the per-session watermark scan — a FOREIGN session's mark inside a submitted
// tree is the circulated-solution tell; a merely-missing own mark is not.
//
// testing/unit-db.ts MUST be the first project import — it sets KP_DB_PATH before
// db-path.ts is evaluated by the transitive `@/app/_lib/db` import.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  appendDevSessionEvents,
  devSessionWatermark,
  getDevSessionIntegrity,
  saveDevSessionFiles,
  startDevSession,
  verifyDevSessionChain,
} from "./devcase.ts";
import { DB_PATH } from "../db-path.ts";
import { scoreAuthenticity } from "../devcase-authenticity.ts";

after(() => cleanupUnitDb());

const NOW = Date.now();
const honestEvents = [
  { t: NOW, kind: "open", path: "src/a.ts" },
  { t: NOW + 1000, kind: "edit", path: "src/a.ts" },
  { t: NOW + 2000, kind: "decision_log", path: "DECISIONS.md" },
];

test("an untouched log verifies; every event carries a chain link", () => {
  const s = startDevSession({ token: null, candidateRef: "chain-clean" });
  appendDevSessionEvents(s.id, honestEvents);
  appendDevSessionEvents(s.id, [{ t: NOW + 3000, kind: "submit", path: "src/a.ts" }]); // second flush links onto the first
  const verdict = verifyDevSessionChain(s.id);
  assert.equal(verdict.valid, true, "the chain recomputes");
  assert.equal(verdict.events, 4);
  const integrity = getDevSessionIntegrity(s.id);
  assert.equal(integrity.backdatedEvents, 0);
});

test("editing a persisted event breaks the chain and lands authenticity in suspect", () => {
  const s = startDevSession({ token: null, candidateRef: "chain-tamper" });
  appendDevSessionEvents(s.id, honestEvents);
  // Backward manipulation: rewrite event #2 in place (e.g. to fake read-before-write
  // ordering) without knowing how to recompute the downstream links.
  const raw = new Database(DB_PATH);
  raw.prepare(`UPDATE dev_session_events SET t = ? WHERE session_id = ? AND seq = 2`).run(NOW - 50_000, s.id);
  raw.close();
  const verdict = verifyDevSessionChain(s.id);
  assert.equal(verdict.valid, false, "the recomputation catches the edit");
  assert.equal(verdict.brokenAtSeq, 2);
  // The exact predicate runEvaluateSubmission computes, and its decisive effect.
  const integrity = getDevSessionIntegrity(s.id);
  const compromised = integrity.chain.valid === false || integrity.backdatedEvents > 0 || integrity.watermark.foreign.length > 0;
  assert.equal(compromised, true);
  const scored = scoreAuthenticity({
    commitCount: 0,
    bursty: null,
    spanHours: null,
    decisionsLogPresent: true,
    readBeforeWrite: 0.6,
    iterationPattern: "linear",
    observed: true,
    integrityCompromised: true,
  });
  assert.equal(scored.band, "suspect", "a manipulated trace is held for the live interview");
  assert.ok(scored.reasons.some((r) => r.includes("integrity")));
});

test("a backdated client timestamp is flagged without breaking the chain", () => {
  const s = startDevSession({ token: null, candidateRef: "chain-backdate" });
  // Client claims the file was opened an hour before the session existed — the
  // fabricated-ordering play. The chain is intact (the server hashed what was sent);
  // the clock check catches the lie instead.
  appendDevSessionEvents(s.id, [{ t: NOW - 60 * 60 * 1000, kind: "open", path: "src/a.ts" }, ...honestEvents]);
  const integrity = getDevSessionIntegrity(s.id);
  assert.equal(integrity.chain.valid, true);
  assert.ok(integrity.backdatedEvents >= 1, "the pre-session timestamp is flagged");
});

test("watermark: own mark passes; a foreign mark is the circulation tell", () => {
  const a = startDevSession({ token: null, candidateRef: "wm-a" });
  const b = startDevSession({ token: null, candidateRef: "wm-b" });
  const own = devSessionWatermark(a.id);
  const foreign = devSessionWatermark(b.id);
  assert.notEqual(own, foreign);
  assert.match(own, /^wm-[0-9a-f]{10}$/);

  // Honest submission: carries its own mark only.
  saveDevSessionFiles(a.id, [{ path: "DECISIONS.md", contents: `# D\n\nSession ref: ${own}\n` }]);
  let integ = getDevSessionIntegrity(a.id);
  assert.equal(integ.watermark.present, true);
  assert.deepEqual(integ.watermark.foreign, []);

  // Circulated submission: session A's tree contains session B's mark.
  saveDevSessionFiles(a.id, [{ path: "DECISIONS.md", contents: `# D\n\nSession ref: ${foreign}\n` }]);
  integ = getDevSessionIntegrity(a.id);
  assert.deepEqual(integ.watermark.foreign, [foreign], "the foreign mark is detected");
  // Missing own mark alone is NOT decisive; the foreign mark is.
  assert.equal(integ.watermark.present, false);
});
