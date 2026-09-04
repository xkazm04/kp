// THE RESPONSE + BUDGET CONTRACT of POST /api/automation/[task] — the per-entry AI
// step the board's actions grid fires.
//
// Two defects this pins shut, both invisible to a value test because they are
// properties of the SOURCE (a route handler needs a Next request scope the bare
// runner cannot give it — the same reason rate-limit-contract.test.ts and
// error-response-contract.test.ts read source):
//
//   1. Every failure was answered with the thrown error's own message. For an engine
//      failure that message is parseStderrError's: a Python traceback, argparse usage
//      text, the absolute workdir path, a provider's stderr. Its sibling
//      /api/automation/schedule has answered `safeJsonError` since 2026-09-03.
//   2. One POST spawns a Python child, spends on the configured model, and — for
//      `outreach` — DISPATCHES a letter to a candidate, with no limiter at all, while
//      the sibling door onto the same runAutomationTask("outreach") call has had one
//      since /perfect 2026-09-02. The budget itself is pinned by
//      rate-limit-contract.test.ts; what this file adds is the ORDER around it.
//
// Runner: node:test, via `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

// Line endings normalised: this checkout carries CRLF while a worktree may be LF, and
// the ordering assertions below index into the text.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8").replace(/\r\n/g, "\n");

// The refusal vocabulary is DERIVED from the module that decides it, never typed out
// here — a new refusal token with no coded answer must fail this file, not ship as a
// raw 400.
const { AUTOMATION_REFUSALS } = await import("../../../_lib/automation-run.ts");
cleanupUnitDb();

test("every refusal this module decides has a coded answer at the door", () => {
  for (const token of AUTOMATION_REFUSALS) {
    assert.match(
      src,
      new RegExp(`\\b${token}: "[A-Z_]+"`),
      `AUTOMATION_REFUSALS carries "${token}" but the route maps it to no refusal code — it would fall through to the generic engine-failure path and answer a 500`
    );
  }
});

test("a decided refusal is answered as a CODE, at the status the module chose", () => {
  assert.match(src, /jsonRefusal\(REFUSAL_FOR\[error\.refusal\], error\.status\)/);
  // Non-vacuity: the mapping must be consulted only for a tagged refusal, so an engine
  // failure cannot be laundered into one of these sentences.
  assert.match(src, /error instanceof AutomationError && error\.refusal/);
});

test("an ENGINE failure answers a store code and never the thrown message", () => {
  assert.match(src, /safeJsonError\(error, "api:automation\/task", "AUTOMATION_TASK_FAILED", status\)/);
  // The engine's own status survives, so a user-fixable 400 does not collapse to a 500.
  assert.match(src, /const status = error instanceof AutomationError \? error\.status : 500;/);
  // THE LEAK, gone: no arm of this handler may put a thrown error's message on the wire.
  // Comments are not scanned — this file quotes none.
  assert.ok(!/error\.message/.test(src), "a raw thrown message is back on the wire");
  assert.ok(!/error instanceof Error \? error\.message/.test(src));
});

test("the missing-entryId refusal is served BEFORE the throttle", () => {
  const refusal = src.indexOf('jsonRefusal("AUTOMATION_ENTRY_REQUIRED", 400)');
  const limiter = src.indexOf("rateLimit(`automation-task:");
  assert.ok(refusal > 0, "a body with no entryId is refused with a code, not English prose");
  assert.ok(limiter > refusal, "a malformed body must neither consume budget nor be masked by a 429");
});

test("the throttle precedes the spend, and the operator gate precedes the throttle", () => {
  const gate = src.indexOf("const denied = await requireOperator();");
  const limiter = src.indexOf("rateLimit(`automation-task:");
  const spend = src.indexOf("await runAutomationTask(body.entryId,");
  assert.ok(gate > 0 && limiter > gate, "a non-operator must never be able to spend another caller's window");
  assert.ok(spend > limiter, "the limiter must gate the spawn + model spend it exists to bound");
  assert.match(src, /jsonRefusal\("TOO_MANY_REQUESTS", 429\)/, "the one shared refusal chokepoint");
});
