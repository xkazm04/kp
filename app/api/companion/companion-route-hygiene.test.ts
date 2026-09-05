// COMPANION ROUTE HYGIENE — four honesty properties of the companion API that a
// running test cannot reach and a reviewer cannot be relied on to re-derive.
//
// Route handlers import through the "@/…" alias, which Node's test runner does
// not resolve, so this is a SOURCE guard in the idiom rate-limit-contract.test.ts
// and upload-size-contract.test.ts already established here. Each assertion pins
// a property whose absence was a silent lie rather than an error:
//
//   1. A thread deleted mid-request answers 404, never a 200 whose transcript is
//      missing the exchange it reports. Both appends re-check the thread inside
//      their own transaction and answer null; both answers were discarded.
//   2. The request's AbortSignal reaches the spawn, so a closed tab does not
//      leave a 120s Python child and a paid model call running.
//   3. The title derived from the first exchange is written under a `title = ''`
//      precondition — the route decides emptiness from a read that predates the
//      write by a whole model call.
//
// Runner: node:test with type stripping — `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

test("POST /api/companion/[id]/message refuses a vanished thread instead of answering 200", () => {
  const src = read("./[id]/message/route.ts");

  // The store's own contract: both writers answer null when the thread is gone.
  // Pinning the CALL SHAPE is the point — a bare `appendTurn({…})` statement is
  // exactly the regression this test exists to catch.
  assert.ok(
    src.includes('if (!appendTurn({ threadId: id, role: "user", content: message }, ws)) {'),
    "the user turn's append must be checked — a discarded null is a lost message",
  );
  assert.match(
    src,
    /const stored = appendTurnWithProposals\(/,
    "the reply's append must be captured, not discarded",
  );
  assert.ok(
    src.includes("if (!stored) return jsonRefusal(\"COMPANION_THREAD_NOT_FOUND\", 404);"),
    "a null from the reply's append must refuse, not fall through to a 200",
  );

  // Both refusals go through the chokepoint, so the dock gets a code it can
  // localize rather than an English sentence it can only print.
  assert.equal(
    src.split('jsonRefusal("COMPANION_THREAD_NOT_FOUND", 404)').length - 1,
    3,
    "three 404s: the unknown thread, the vanished user turn, the vanished reply",
  );
  assert.doesNotMatch(
    src,
    /Companion thread not found\./,
    "the hand-written English 404 body is replaced by the coded refusal",
  );

  // The user turn's check must precede the spawn: a thread that is already gone
  // must never buy a model call.
  const guardAt = src.indexOf('if (!appendTurn({ threadId: id, role: "user"');
  const spawnAt = src.indexOf("await runCompanionTurn(");
  assert.ok(guardAt >= 0 && spawnAt > guardAt, "the vanished-thread refusal must precede the paid spawn");
});

test("POST /api/companion/[id]/message hands the request's AbortSignal to the spawn", () => {
  const src = read("./[id]/message/route.ts");
  const at = src.indexOf("await runCompanionTurn(");
  assert.ok(at >= 0, "expected the turn call");
  const call = src.slice(at, src.indexOf("\n    );", at));
  assert.match(call, /request\.signal/, "the request's own signal must reach runCompanionTurn");

  // …and the run seam must actually thread it down to the child process, or the
  // argument above is decoration.
  const run = readFileSync(fileURLToPath(new URL("../../_lib/companion-run.ts", import.meta.url)), "utf8");
  assert.match(
    run,
    /export async function runCompanionTurn\([\s\S]*?signal\?: AbortSignal/,
    "runCompanionTurn must accept the signal",
  );
  assert.match(run, /spawnPython\(args, \{ signal,/, "spawnCompanion must pass it to the child process");
});

test("renameThread only ever titles an UNTITLED thread", () => {
  const src = readFileSync(fileURLToPath(new URL("../../_lib/db/companion.ts", import.meta.url)), "utf8");
  const at = src.indexOf("export function renameThread(");
  assert.ok(at >= 0, "expected renameThread");
  const body = src.slice(at, src.indexOf("\n}", at));
  assert.match(
    body,
    /UPDATE companion_threads SET title = \?[\s\S]*?WHERE id = \? AND workspace_id = \? AND title = ''/,
    "the UPDATE must re-assert the emptiness its caller read seconds earlier",
  );
  assert.match(body, /return res\.changes > 0;/, "…and report the skip rather than claiming the write");
});

test("every companion 429 answers with a code the dock can localize", () => {
  for (const rel of [
    "./[id]/message/route.ts",
    "./threads/route.ts",
    "./brain/route.ts",
    "./proposals/[id]/resolve/route.ts",
  ]) {
    const src = read(rel);
    assert.doesNotMatch(
      src,
      /\{ error: RATE_LIMITED_ERROR \}/,
      `${rel}: a bare throttle body leaves the dock nothing to resolve — use jsonRefusal("TOO_MANY_REQUESTS", 429)`,
    );
    assert.match(src, /jsonRefusal\("TOO_MANY_REQUESTS", 429\)/, `${rel}: expected the coded 429`);
  }
});

test("every listTurns caller states the bound it is reading", () => {
  // The store now reads the NEWEST turns, which makes the bound a decision:
  // what the dock renders and what the model is shown are different numbers,
  // and a caller that takes the default has silently picked one of them. Both
  // routes name the constant they mean (companion-turn.ts).
  for (const rel of ["./[id]/message/route.ts", "./threads/route.ts"]) {
    const src = read(rel).replace(/\r\n/g, "\n");
    for (const call of src.match(/listTurns\([^)]*\)/g) ?? []) {
      assert.match(
        call,
        /,\s*COMPANION_(THREAD|PROMPT_SCAN)_TURNS\s*\)/,
        `${rel}: ${call} inherits the store's default instead of stating its bound`,
      );
    }
  }
});

test("the prompt transcript carries each turn's source, and every reply stores one", () => {
  const src = read("./[id]/message/route.ts").replace(/\r\n/g, "\n");
  // Without the field, promptEligibleTurns has nothing to filter on and the
  // outage replay comes straight back — silently, since the shape still fits.
  assert.match(
    src,
    /transcript: history\.map\(\(t\) => \(\{ role: t\.role, content: t\.content, source: t\.meta\?\.source \?\? null \}\)\)/,
    "the transcript handed to the engine must carry meta.source per turn",
  );
  // …and the source has to have been WRITTEN, or every stored reply looks like
  // a pre-field turn and none of them can ever be filtered.
  const at = src.indexOf("const stored = appendTurnWithProposals(");
  assert.ok(at >= 0, "expected the reply's append");
  assert.match(
    src.slice(at, src.indexOf("\n      ws,", at)),
    /meta: \{\n\s*source: turn\.source,/,
    "the assistant turn's meta must record which side answered",
  );
});

test("a 409 from the resolve route carries the proposal row the client must repaint", () => {
  const src = read("./proposals/[id]/resolve/route.ts").replace(/\r\n/g, "\n");
  // The dock's contract is "take the response's proposal whatever the status" —
  // a 409 with only a code left the card armed on a closed proposal, so every
  // further click bought another 409 until a poll happened.
  assert.match(
    src,
    /function alreadyResolved\(proposal: CompanionProposal \| null\) \{[\s\S]*?code: "COMPANION_PROPOSAL_RESOLVED", proposal \}/,
    "the 409 body must carry the server's current row beside the code",
  );
  assert.equal(
    (src.match(/return alreadyResolved\(/g) ?? []).length,
    3,
    "three already-answered paths go through it: the pre-check, the lost decline, the lost claim",
  );
  assert.doesNotMatch(
    src,
    /That proposal was already resolved\./,
    "…and none of them re-types the sentence STORE_ERRORS already owns",
  );
});
