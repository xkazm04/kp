// The pure half of the intake dialog's client state: folding a VOICE result
// into the open session. Both voice threads resolve long after they were fired
// (an extraction sweep is a model call), by which time the requestor may have
// gone Back and opened a different intake — so a result must name the session
// it belongs to. Runner: `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  foldVoiceExchange,
  foldVoiceSweep,
  readRepoScanResponse,
  scanStateFor,
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
  updatedAt: null,
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

// The same "a result must name the session it belongs to" rule this file opens
// with, applied to the App-master hook's SYNCHRONOUS state. `applySession` already
// identity-checks every late async result; `scanState`, `composeError` and
// `dispatchState` had no such guard and simply outlived their session, because
// JdsIntakePanel is mounted ONCE by JdsSavedLedger (no `key`) and swaps `active`
// underneath the hook. A session switch then carried a "reading the codebase…"
// note onto an unrelated session, and a `sent` dispatch state that disabled the
// Dispatch button for a session nobody had dispatched. Asserted at the source: the
// hook needs React to run, and the property is structural, not computational.
// The compose failure is shown from the server's CODE, never from its English
// `error` string, and a 180-second spawn is cancellable. Both are structural
// properties of the hook's source (it needs React to run).
test("useAppMasterLogic keeps the compose failure's code and can cancel the spawn", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "jdsIntakeAppMaster.ts"), "utf8");

  assert.match(
    src,
    /useState<\{ code: string \| null \} \| null>\(null\)/,
    "composeError must carry the code the card resolves, not a placeholder string"
  );
  assert.ok(!src.includes('setComposeError("compose")'), "the one-size-fits-all failure string is the old hole");
  // The code comes off the response body, never the `error` message beside it.
  assert.match(src, /setComposeError\(\{ code: body\?\.code \?\? null \}\)/);
  assert.ok(!/setComposeError\(\{[^}]*error/.test(src), "the server's English string must not reach the card");

  // Cancel: a controller is held, threaded into the fetch, and an abort is not
  // reported as a failure.
  assert.match(src, /const controller = new AbortController\(\)/);
  assert.match(src, /signal: controller\.signal/);
  assert.match(src, /!== "AbortError"/, "an aborted compose must not render as an error");
  assert.match(src, /const cancelCompose = useCallback/);
});

test("useAppMasterLogic resets its per-session state when the intake changes", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "jdsIntakeAppMaster.ts"), "utf8");

  const at = src.indexOf("if (stateForIntake !== intakeId) {");
  assert.ok(at > 0, "the per-session reset guard moved — re-point this assertion");
  // To the guard's own closing brace at hook indentation — an inner `}` belongs to
  // an object literal (`{ status: "idle" }`), not to the block.
  const block = src.slice(at, src.indexOf("\n  }", at));
  for (const reset of ["setScanState(null)", "setComposeError(null)", 'setDispatchState({ status: "idle" })']) {
    assert.ok(block.includes(reset), `a session switch must clear ${reset}`);
  }

  // NON-VACUITY: `paired` is bridge-level, not per-session, and must NOT be in
  // the reset — clearing it re-fetches /api/agents/bridge on every switch.
  assert.ok(!block.includes("setPaired("), "the bridge pairing is not per-session state");
});


// ---- The scan's one line -------------------------------------------------------
//
// A four-minute scan could say exactly two things about how it ended: "failed" and
// "complete". Both were true and neither was useful — "git is not installed" and
// "the clone timed out" are different problems with different remedies, and a
// "complete" dossier that came off the file-walk floor because the agent died looks
// identical to one an agent actually read. scanStateFor is where the row stops
// under-claiming.

test("a failure is named by its class, and an unnamed one still says failed", () => {
  const base = { id: "s1", source: null, dossier: null } as const;
  assert.equal(scanStateFor({ ...base, status: "failed", errorCode: "git_missing" }), "failedGitMissing");
  assert.equal(scanStateFor({ ...base, status: "failed", errorCode: "offline_refused" }), "failedOfflineRefused");
  assert.equal(scanStateFor({ ...base, status: "failed", errorCode: "cancelled" }), "failedCancelled");
  // Unclassified, absent (a row written before the column existed), and a code this
  // build has never heard of all fall to the generic line rather than to a key that
  // does not resolve.
  assert.equal(scanStateFor({ ...base, status: "failed", errorCode: "unknown" }), "failed");
  assert.equal(scanStateFor({ ...base, status: "failed" }), "failed");
  assert.equal(scanStateFor({ ...base, status: "failed", errorCode: "the_vibes_were_off" }), "failed");
});

test("a completion says nothing when it is clean, and says so when it fell back", () => {
  const base = { id: "s1", source: "llm", dossier: null } as const;
  // Nothing left to disclose: the card's own provenance chip covers the rest.
  assert.equal(scanStateFor({ ...base, status: "complete" }), null);
  assert.equal(scanStateFor({ ...base, status: "complete", fallbackClass: null }), null);
  assert.equal(scanStateFor({ ...base, status: "complete", fallbackClass: "agent_timeout" }), "fellBackAgentTimeout");
  assert.equal(
    scanStateFor({ ...base, status: "complete", fallbackClass: "agent_not_installed" }),
    "fellBackAgentNotInstalled"
  );
  // A class from a newer Python than this build knows still discloses the fallback.
  assert.equal(scanStateFor({ ...base, status: "complete", fallbackClass: "agent_ran_away" }), "fellBackUnknown");
});

test("an in-flight scan is reported as itself", () => {
  const base = { id: "s1", source: null, dossier: null } as const;
  assert.equal(scanStateFor({ ...base, status: "queued" }), "queued");
  assert.equal(scanStateFor({ ...base, status: "running" }), "running");
});

test("the scan can be cancelled, and only while there is something to cancel", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "jdsIntakeAppMaster.ts"), "utf8");
  // The cancel goes through the EXISTING task-cancel door (DELETE /api/tasks/[id]
  // via the provider), not a new endpoint.
  assert.match(src, /cancelTask\(scanTaskId\)/);
  // …on the task that belongs to THIS scan. The polled list projects params out, so
  // the full record is fetched and matched by scanId; cancelling by kind alone would
  // stop somebody else's scan.
  assert.match(src, /\)\?\.scanId === scanId/);
  // Never offered once the dossier has landed or the scan has ended.
  assert.match(src, /scanState === "queued" \|\| scanState === "running"/);
  assert.match(src, /!hasDossier/);
});
