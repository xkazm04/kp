// The pure half of the intake dialog's client state: folding a VOICE result
// into the open session. Both voice threads resolve long after they were fired
// (an extraction sweep is a model call), by which time the requestor may have
// gone Back and opened a different intake — so a result must name the session
// it belongs to. Runner: `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  foldVoiceExchange,
  foldVoiceSweep,
  readRepoScanResponse,
  type IntakeSession,
  type VoiceSweepResult,
} from "./jdsIntakeLogic.ts";
import type { RoleBrief } from "@/app/_lib/rolespec";

const brief = (title: string, skill: string): RoleBrief =>
  ({
    schemaVersion: 1,
    title,
    seniority: "senior",
    roleFamily: "software_engineering",
    languages: [],
    summary: "",
    responsibilities: [],
    successCriteria: [],
    requirements: [
      { skill, kind: "must_have", hardness: "prerequisite", weight: 0.8, rationale: "", provenance: "stated", confidence: 1, sourceTurn: 2 },
    ],
    facets: [],
    spineProvenance: {},
    promptVersion: "",
  }) as RoleBrief;

const session = (id: string): IntakeSession => ({
  id,
  title: "Data Analyst",
  status: "open",
  lang: "cs",
  transcript: [{ role: "interviewer", text: "What must they already know?" }],
  brief: brief("Data Analyst", "SQL"),
  attachments: [],
  shape: null,
  scanId: null,
  dossier: null,
  appMaster: null,
  jdSlug: null,
});

const sweep: VoiceSweepResult = {
  transcript: [{ role: "candidate", text: "must have a security clearance" }],
  brief: brief("Security Engineer", "security clearance"),
  shape: "power_unit",
  extracted: true,
  source: "llm",
};

test("a voice sweep folds into the session it belongs to", () => {
  const folded = foldVoiceSweep(session("intake-a"), "intake-a", sweep);
  assert.equal(folded?.brief?.requirements?.[0].skill, "security clearance");
  assert.equal(folded?.title, "Security Engineer");
  assert.equal(folded?.shape, "power_unit");
});

test("a voice sweep landing after the requestor switched sessions is DROPPED", () => {
  // Back → open another intake while the hang-up extraction is still running.
  // Applied blindly, session B's brief became session A's — and the next Save
  // PATCHed A's dealbreakers onto B, where they knock candidates out.
  const b = session("intake-b");
  const folded = foldVoiceSweep(b, "intake-a", sweep);
  assert.equal(folded, b); // same object: untouched
  assert.equal(folded?.brief?.requirements?.[0].skill, "SQL");
});

test("a spoken exchange appends the pair — and only to its own session", () => {
  const payload = { userText: "they need a clearance", reply: "Noted. Anything else?", done: false };
  const mine = foldVoiceExchange(session("intake-a"), "intake-a", payload);
  assert.deepEqual(
    mine?.transcript.map((t) => t.text),
    ["What must they already know?", "they need a clearance", "Noted. Anything else?"]
  );
  const b = session("intake-b");
  assert.equal(foldVoiceExchange(b, "intake-a", payload), b);
  assert.equal(b.transcript.length, 1);
});

test("a spoken confirmed close flips status — but never a session that is no longer open on screen", () => {
  const payload = { userText: "yes, that's right", reply: "Great — I have what I need.", done: true };
  assert.equal(foldVoiceExchange(session("intake-a"), "intake-a", payload)?.status, "complete");
  assert.equal(foldVoiceExchange(session("intake-b"), "intake-a", payload)?.status, "open");
  assert.equal(foldVoiceSweep(null, "intake-a", sweep), null);
});

// The P2 ↔ P3 seam. `GET /api/repo-scan/[id]` answers `{ scan }`; the App-master
// watcher read the row FLAT, so `status` was undefined, the "has it completed?"
// test never fired, and a scan that finished in a second left the card saying
// "the scan is still reading the codebase" forever — no error, no dossier, no
// spec, no hire. Found by e2e/app-master-hire.spec.ts; pinned here so the shape
// cannot drift back without a unit failure.
test("a repo-scan response is read through its { scan } wrapper, never flat", () => {
  const row = { id: "rscan-1", status: "complete", source: "heuristic", dossier: { dossierId: "rscan-1" }, isLocal: true };

  const view = readRepoScanResponse({ scan: row });
  assert.equal(view?.status, "complete");
  assert.equal(view?.source, "heuristic");
  assert.ok(view?.dossier, "the finished dossier is what the intake is waiting for");

  // NON-VACUITY: the pre-fix read. A flat row is NOT the route's contract, and
  // accepting it silently is what hid the bug — it must refuse, so the caller
  // shows "can't reach the scan, retrying" instead of a permanent "still reading".
  assert.equal(readRepoScanResponse(row), null, "the flat row is not the wire shape");
  assert.equal(readRepoScanResponse({ error: "Repo scan not found." }), null);
  assert.equal(readRepoScanResponse({ scan: null }), null);
  assert.equal(readRepoScanResponse(null), null);
});
