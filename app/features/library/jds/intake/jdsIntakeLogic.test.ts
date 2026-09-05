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
  scanFenceWarningFor,
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
  // A watchdog reap and a Cancel are different lines because they have opposite
  // remedies: re-running undoes a Cancel and reproduces a reap.
  assert.equal(scanStateFor({ ...base, status: "failed", errorCode: "timeout" }), "failedTimeout");
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

// The fence disclosure is a SECOND, independent fact about a scan: an agent can have
// read the repository behind deny rules nobody has verified for the CLI it ran on,
// and the run can still have completed perfectly. scanStateFor says nothing about
// that, by design, so this is where it stops going unsaid.

test("an unverified fence is disclosed on an otherwise clean completion", () => {
  const base = { id: "s1", source: "llm" } as const;
  const withFence = (state: string) =>
    scanFenceWarningFor({ ...base, status: "complete", dossier: { scanFence: { state } } as never });
  assert.equal(withFence("unverified_version"), "fenceUnverified");
  assert.equal(withFence("version_unknown"), "fenceVersionUnknown");
});

test("a verified fence, and a scan with no fence to verify, say nothing", () => {
  const base = { id: "s1", source: "llm" } as const;
  for (const state of ["verified", "not_applicable"]) {
    assert.equal(
      scanFenceWarningFor({ ...base, status: "complete", dossier: { scanFence: { state } } as never }),
      null,
      state
    );
  }
});

test("a row with no fence block reads as no claim, not as a warning", () => {
  const base = { id: "s1", source: "llm" } as const;
  // A scan written before the field existed, a dossier the schema stripped it from,
  // and a state this build has never heard of all fall silent — a warning nobody can
  // act on is worse than none.
  assert.equal(scanFenceWarningFor({ ...base, status: "complete", dossier: null }), null);
  assert.equal(scanFenceWarningFor({ ...base, status: "complete", dossier: {} as never }), null);
  assert.equal(
    scanFenceWarningFor({ ...base, status: "complete", dossier: { scanFence: "nope" } as never }),
    null
  );
  assert.equal(
    scanFenceWarningFor({ ...base, status: "complete", dossier: { scanFence: { state: "vibes" } } as never }),
    null
  );
  // ...and an unfinished scan has not earned a claim about its fence either.
  assert.equal(
    scanFenceWarningFor({ ...base, status: "running", dossier: { scanFence: { state: "unverified_version" } } as never }),
    null
  );
});

// A REFUSED dossier POST is not an unreachable scan. The route throttles at
// 20/10min per IP and answers 409 when a dialog turn moved the brief under the
// merge; the watcher used to render the first as "can't reach the scan" (sending
// the requestor off to re-scan a repository for nothing) and the second as
// nothing at all, while re-posting on every tasks tick and paying a Python spawn
// each time. The ladder itself is pure and pinned by
// app/_lib/app-master/dossier-retry.test.ts; this is the wiring, asserted at the
// source because the hook needs React to run.
test("a refused dossier POST is classified and backed off, not called unreachable", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "jdsIntakeAppMaster.ts"), "utf8");

  // The rule is IMPORTED, never re-derived beside the state it sets.
  assert.match(src, /from "@\/app\/_lib\/app-master\/dossier-retry"/);
  assert.match(src, /planDossierRetry\(outcome, postAttempts\.current\)/);
  // 429 and 409 each get their own outcome; the catch-all keeps "unreachable".
  assert.match(src, /post\.status === 429/);
  assert.match(src, /retryAfterMsFrom\(post\.headers\.get\("Retry-After"\)\)/);
  assert.match(src, /post\.status === 409/);
  assert.match(src, /\{ kind: "conflict" \}/);
  // NON-VACUITY: the two pre-fix lines. A 409 must no longer return silently,
  // and a 429 must no longer fall through to the catch that says "unreachable".
  assert.ok(!/if \(post\.status === 409\) return;/.test(src), "the silent 409 early-return is the old hole");
  assert.ok(
    !/throw new Error\(`HTTP \$\{post\.status\}`\)/.test(src),
    "a refused POST must not be thrown into the catch that claims the scan is unreachable"
  );

  // The wait is real: the retry timer is scheduled for the ladder's delay, not
  // for the next tasks tick.
  assert.match(src, /setRetryAt\(Date\.now\(\) \+ plan\.waitMs\)/);
  assert.match(src, /setTimeout\(\(\) => void run\(\), Math\.max\(0, retryAt - Date\.now\(\)\)\)/);
  assert.ok(src.includes("hasDossier, applySession, retryAt]"), "retryAt must re-arm the effect");
  // …and it is bounded: when the plan says stop, `posted` stays set, which is
  // what makes the watcher stop asking.
  assert.match(src, /if \(plan\.retry\) \{\s*\r?\n\s*posted\.current = null;/);
});

// `composedAt` was stored by the compose route and read by NO surface, so a spec
// composed against an early brief looked exactly like one composed a second ago
// — under a button that hands a mandate to an accountable owner. The comparison
// itself is pure (app/_lib/app-master/spec-vintage.test.ts); these are the two
// halves that carry it to the screen.
test("the composed spec's vintage is derived and rendered", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const hook = readFileSync(path.join(dir, "jdsIntakeAppMaster.ts"), "utf8").replace(/\r\n/g, "\n");
  const card = readFileSync(path.join(dir, "JdsIntakeAppMasterCard.tsx"), "utf8").replace(/\r\n/g, "\n");

  // The hook derives it from the two timestamps it already holds — no new fetch,
  // no stored field that could go out of date.
  assert.match(hook, /from "@\/app\/_lib\/app-master\/spec-vintage"/);
  assert.match(hook, /composedAt: active\?\.appMaster\?\.composedAt \?\? null/);
  assert.match(hook, /briefUpdatedAt: active\?\.updatedAt \?\? null/);
  assert.match(hook, /specVintage: vintage,/, "the hook must expose it");

  // The card renders it, and only as a disclosure: an unknown vintage says
  // nothing, and a stale one never disables the control.
  assert.match(card, /specVintage = "unknown"/);
  assert.match(card, /specVintage === "stale"/);
  assert.match(card, /t\("spec\.staleChip"\)/);
  assert.match(card, /t\("spec\.stale"\)/);
  assert.ok(!/disabled=\{[^}]*specVintage/.test(card), "a stale spec is still dispatchable — the requestor decides");
});
