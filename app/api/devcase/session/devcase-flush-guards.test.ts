// THE CANDIDATE DOORS CLOSE THEIR GAPS (/perfect 2026-09-02, api-devcase-1).
//
// `/api/devcase/session/**` is PUBLIC by design (public-routes.ts): the candidate has no
// account and the apply link IS the credential. Three of those doors mutate — the flush
// (`POST /session/[id]`: appends observed-process events and OVERWRITES the file tree),
// chat (`POST /session/[id]/chat`: a real, paid model call) and submit. This file pins the
// two properties that were unevenly held across them:
//
//  1. A TOKENLESS session is refused on every mutating door. Submit already required the
//     apply token unconditionally; the flush and chat both carried a `session.token && …`
//     carve-out, so a row with `token: null` (fixtures, dev seeds) walked past the
//     authorization gate AND past the per-token daily budgets keyed on that same column.
//     A session id is a `Math.random` id, not a boundary — the carve-out made it one.
//  2. The chat route forwards `request.signal` and returns `source`. The signal reaches
//     spawnPython (the kp SIGKILL-on-abort convention) so an abandoned generation does not
//     outlive its request; `source` ("llm" | "deterministic") lets the candidate tell a
//     real stakeholder from the keyless stand-in, which is honesty about a degrade path
//     the product deliberately ships.
//
// Route handlers need a request scope the unit runner cannot give them and import through
// the "@/..." alias Node does not resolve, so — as in rate-limit-contract.test.ts and
// upload-size-contract.test.ts — the guards above are asserted on the SOURCE. The byte
// budget is pure and is driven for real.
//
// Runner: node:test via `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chargeFlushBytes, MAX_FLUSH_BYTES_PER_TOKEN_DAY } from "./session-limits.ts";

function read(rel: string): string {
  // Line endings normalised: a checkout with core.autocrlf=true carries CRLF and a
  // multi-line marker would never match. The contract is about the source, never about
  // the byte that ends a line.
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

// The flush and chat routes; submit is listed because it is the shape the other two are
// being brought to, so a regression there reads as a failure of the same rule.
const MUTATING = ["./[id]/route.ts", "./[id]/chat/route.ts", "./[id]/submit/route.ts"];

for (const rel of MUTATING) {
  test(`${rel} refuses a session that carries no apply token`, () => {
    const src = read(rel);
    // The whole guard, not just the call: `session.token && !sessionTokenMatches(...)`
    // reads almost identically and is exactly the hole this closes.
    assert.match(
      src,
      /!sessionTokenMatches\(session\.token, body\.token\)/,
      "the apply-token re-check must be present",
    );
    assert.doesNotMatch(
      src,
      /if \(session\.token && !sessionTokenMatches\(/,
      "the `session.token &&` carve-out let a tokenless session walk past the gate",
    );
  });
}

test("./[id]/route.ts charges the flush body against a per-apply-token byte budget", () => {
  const src = read("./[id]/route.ts");
  assert.match(src, /from "\.\.\/session-limits"/, "the budget must come from the shared sibling module");
  const rawAt = src.indexOf("const raw = await request.text();");
  assert.ok(rawAt >= 0, "the body must be read as text so its size can be charged");
  const chargeAt = src.indexOf("chargeFlushBytes(session.token, raw.length)");
  assert.ok(chargeAt > rawAt, "the charge must use the size of THIS request's body");
  // …and it must precede the first write, so a refused flush stores nothing.
  const writeAt = src.indexOf("appendDevSessionEvents(id, events)");
  assert.ok(writeAt > chargeAt, "the byte budget must be charged before the first write");
  assert.match(src.slice(chargeAt, chargeAt + 200), /RATE_LIMITED_ERROR/, "the refusal is the shared 429 envelope");
});

test("./[id]/chat/route.ts forwards the request's abort signal to the model run", () => {
  const src = read("./[id]/chat/route.ts");
  const at = src.indexOf("await runSessionChat(");
  assert.ok(at >= 0, "expected the model call");
  const call = src.slice(at, src.indexOf(");", at));
  assert.match(call, /request\.signal/, "an abandoned generation must not outlive its request");
});

test("./[id]/chat/route.ts returns the reply's source so a stub is not passed off as a model", () => {
  const src = read("./[id]/chat/route.ts");
  assert.match(src, /const \{ reply, source \} = await runSessionChat\(/, "`source` must not be destructured away");
  assert.match(src, /NextResponse\.json\(\{ reply, source \}\)/, "…and must reach the candidate");
});

test("chargeFlushBytes bounds the aggregate flush body per apply token per day", () => {
  const t0 = 20_000_000;
  const token = "tok-budget-contract";
  const half = MAX_FLUSH_BYTES_PER_TOKEN_DAY / 2;
  assert.equal(chargeFlushBytes(token, half, t0), true, "the first half of the budget passes");
  assert.equal(chargeFlushBytes(token, half, t0 + 1), true, "the second half passes — the budget is not spent yet");
  assert.equal(chargeFlushBytes(token, 1, t0 + 2), false, "one byte past the budget is refused");
  // A fresh 24h window admits again: a throttled link recovers without a restart.
  assert.equal(
    chargeFlushBytes(token, 1, t0 + 24 * 60 * 60 * 1000 + 1),
    true,
    "a fresh window must admit again",
  );
  // Independent tokens never starve each other.
  assert.equal(chargeFlushBytes("tok-budget-other", 1, t0 + 3), true, "a different apply token has its own budget");
  // A single body larger than the whole day's budget is refused on its own request.
  assert.equal(
    chargeFlushBytes("tok-budget-oversize", MAX_FLUSH_BYTES_PER_TOKEN_DAY + 1, t0 + 4),
    false,
    "one oversized body cannot be admitted just because the window was empty",
  );
});
