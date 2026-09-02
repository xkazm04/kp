// Source guard for the role-intake routes' REFUSAL and CANCELLATION contract
// (docs/architecture/api-contracts.md §1.1, docs/features/intake/README.md).
//
// Three rules, all of which the nine routes broke at once:
//
//   1. Every refusal carries a CODE. They answered English prose with no code —
//      "Intake not found." six times over, plus a closed session, an attachment
//      limit, an index, "text is required", "JD not found." and "nothing to
//      extract yet" — and the client funnelled every one of them into a single
//      "send failed" line. The feature doc CLAIMED codes; this is what makes the
//      claim true.
//   2. The two writes that sit behind a model call carry the row version they
//      were computed from, so a stated value cannot be reverted by a spawn that
//      returns after it (app/_lib/db/intake-dialog-cas.test.ts pins the store
//      half; this pins that the routes actually pass it).
//   3. The three spawning routes hand `request.signal` to the spawn and answer
//      499 when the caller is gone — a cancelled request must not leave a paid
//      completion running for a screen nobody is watching.
//
// Source-guard style (mirrors voice-close-guard.test.ts / attachments-guard
// .test.ts): node:test cannot resolve the "@/" alias, so the routes are asserted
// over their source text.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

const ROUTES = {
  create: "./route.ts",
  session: "./[id]/route.ts",
  message: "./[id]/message/route.ts",
  brief: "./[id]/brief/route.ts",
  promote: "./[id]/promote/route.ts",
  reopen: "./[id]/reopen/route.ts",
  attachments: "./[id]/attachments/route.ts",
  voiceConnect: "./[id]/voice-connect/route.ts",
  voiceTurn: "./[id]/voice-turn/route.ts",
  voiceComplete: "./[id]/voice-complete/route.ts",
} as const;

const SRC = Object.fromEntries(Object.entries(ROUTES).map(([k, rel]) => [k, read(rel)])) as Record<
  keyof typeof ROUTES,
  string
>;

// The whole point: not one refusal on this surface may be a bare sentence again.
test("no role-intake route answers a refusal with prose instead of a code", () => {
  for (const [name, src] of Object.entries(SRC)) {
    for (const status of ["400", "403", "404", "409", "410", "429", "503"]) {
      const hits = src.match(new RegExp(`NextResponse\\.json\\([^;]*status:\\s*${status}`, "g")) ?? [];
      assert.deepEqual(hits, [], `${name}: a ${status} still hand-rolls an { error } envelope — use jsonRefusal`);
    }
  }
});

test("every route imports the refusal chokepoint it now answers through", () => {
  for (const [name, src] of Object.entries(SRC)) {
    // The two ledger reads (GET /api/intake) refuse nothing but the throttle;
    // every other module must reach jsonRefusal.
    assert.match(src, /import \{[^}]*jsonRefusal[^}]*\} from "@\/app\/_lib\/api-response"/, `${name}: no jsonRefusal`);
  }
});

test("the lifecycle refusals keep their distinct codes", () => {
  // `complete` and `promoted` are NOT the same refusal: a complete session can be
  // re-opened and that is the reader's next action, a promoted one is final.
  for (const name of ["message", "voiceTurn", "voiceConnect"] as const) {
    assert.match(SRC[name], /jsonRefusal\("INTAKE_NOT_FOUND", 404\)/, `${name}: 404`);
    assert.match(SRC[name], /jsonRefusal\("INTAKE_CLOSED", 409\)/, `${name}: closed`);
  }
  assert.match(SRC.brief, /jsonRefusal\("INTAKE_FROZEN", 409\)/);
  assert.match(SRC.voiceComplete, /jsonRefusal\("INTAKE_FROZEN", 409\)/);
  // Re-open distinguishes "promoted" from "already open" — same status, different
  // next action, and they used to be two English strings behind one failure line.
  assert.match(SRC.reopen, /INTAKE_FROZEN[\S\s]*:[\S\s]*INTAKE_ALREADY_OPEN/);
  assert.match(SRC.promote, /jsonRefusal\("INTAKE_BRIEF_NOT_READY", 400\)/);
});

test("the attachments route names WHICH refusal happened, and carries the cap as data", () => {
  assert.match(SRC.attachments, /jsonRefusal\("INTAKE_ATTACHMENT_INDEX", 400\)/);
  assert.match(SRC.attachments, /jsonRefusal\("INTAKE_ATTACHMENT_LIMIT", 400, \{ max: ATTACHMENT_LIMIT \}\)/);
  assert.match(SRC.attachments, /jsonRefusal\("INTAKE_JD_NOT_FOUND", 404\)/);
  assert.match(SRC.attachments, /jsonRefusal\("INTAKE_TEXT_REQUIRED", 400\)/);
});

// The env vars an operator must set are DATA beside the code, not an English
// sentence with the variable names baked into it.
test("voice-connect answers an unconfigured provider with a code plus the env it needs", () => {
  assert.match(
    SRC.voiceConnect,
    /jsonRefusal\("INTAKE_VOICE_NOT_CONFIGURED", 503, \{ provider: "openai", need: missingVoiceEnv\(adapter\) \}\)/
  );
});

test("the writes behind a spawn carry the version they were computed from", () => {
  for (const name of ["message", "voiceTurn"] as const) {
    const src = SRC[name];
    assert.match(src, /expectedUpdatedAt: intake\.updatedAt/, `${name}: blind write after a spawn`);
    assert.match(src, /if \(write === "moved"\) return jsonRefusal\("INTAKE_BRIEF_MOVED", 409\)/, `${name}: no moved branch`);
    assert.match(src, /if \(write === "missing"\) return jsonRefusal\("INTAKE_NOT_FOUND", 404\)/, `${name}: no missing branch`);
  }
  // The human brief edit re-asserts its own read for the same vocabulary.
  assert.match(SRC.brief, /updateIntakeBrief\(id, brief, ws, \{ expectedUpdatedAt: intake\.updatedAt \}\)/);
  // The sweep is the deliberate exception: it must NOT refuse, because refusing
  // would drop the hang-up recovery turns it carries (intake-voice-sweep.test.ts).
  assert.ok(
    !SRC.voiceComplete.includes('jsonRefusal("INTAKE_BRIEF_MOVED"'),
    "the extraction sweep appends rather than refusing — a refusal here loses spoken words"
  );
});

test("a cancelled request kills its spawn and answers 499, never a logged fault", () => {
  for (const name of ["message", "voiceTurn", "voiceComplete"] as const) {
    const src = SRC[name];
    assert.match(src, /request\.signal\s*\n?\s*\)/, `${name}: the signal never reaches the spawn`);
    assert.match(
      src,
      /if \(request\.signal\.aborted\) return new NextResponse\(null, \{ status: 499 \}\)/,
      `${name}: an abort is answered as a fault`
    );
    // …and BEFORE the store-error answer, or the cancel is logged as an incident.
    // The CALL, not the bare name: `safeJsonError` also appears in the import line
    // at the top of every one of these modules.
    assert.ok(
      src.indexOf("request.signal.aborted") < src.indexOf("safeJsonError(error"),
      `${name}: the abort branch must precede the store-error answer`
    );
  }
});
