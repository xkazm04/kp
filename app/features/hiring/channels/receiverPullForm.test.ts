// Pull-source editor form logic (challenge 2026-09-22 candidate-channels-ui/B).
//
// The PATCH /api/channels/webhooks body under the repo's stored-credential contract
// (secret omitted = keep, "" = clear, string = replace), the blank-save guard the relay
// and edge cards already carry, and coded refusals resolved by useErrorMessage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canSavePull, interpretPullResponse, pullPatchBody } from "./receiverPullForm";

const stored = { pullUrl: "https://a.example/feed", hasPullSecret: true };

test("secret keep / replace / clear map onto the PATCH body", () => {
  const keep = pullPatchBody("tok_1", { url: "https://a.example/feed", secret: "", clearSecret: false });
  assert.deepEqual(keep, { token: "tok_1", pullUrl: "https://a.example/feed" });
  assert.equal(Object.hasOwn(keep, "pullSecret"), false, "keep means NO pullSecret key at all");

  const replace = pullPatchBody("tok_1", { url: "https://a.example/feed", secret: "abc", clearSecret: false });
  assert.deepEqual(replace, { token: "tok_1", pullUrl: "https://a.example/feed", pullSecret: "abc" });

  const clear = pullPatchBody("tok_1", { url: "https://a.example/feed", secret: "", clearSecret: true });
  assert.deepEqual(clear, { token: "tok_1", pullUrl: "https://a.example/feed", pullSecret: "" });

  // A blank URL is the documented disable; it travels as null, never as "  ".
  assert.equal(pullPatchBody("tok_1", { url: "   ", secret: "", clearSecret: false }).pullUrl, null);
  assert.equal(canSavePull(stored, { url: "https://a.example/feed", secret: "", clearSecret: false }), false, "nothing changed");
  assert.equal(canSavePull(stored, { url: "https://a.example/feed", secret: "abc", clearSecret: false }), true);
  assert.equal(canSavePull(stored, { url: "", secret: "", clearSecret: false }), true, "disabling a KNOWN pull is legitimate");
});

test("a blank save on an unread record is refused (it would disable a pull and clear its cursor)", () => {
  assert.equal(canSavePull(null, { url: "", secret: "", clearSecret: false }), false);
  assert.equal(canSavePull(null, { url: "   ", secret: "abc", clearSecret: false }), false);
  assert.equal(canSavePull(null, { url: "https://b.example/feed", secret: "", clearSecret: false }), true);
  assert.equal(canSavePull(stored, { url: "https://b.example/feed", secret: "", clearSecret: false }, true), false, "busy");
});

test("refusals come back as a CODE, never the body's English prose; 200 {pull} is ok", () => {
  for (const [status, code] of [
    [400, "CHANNEL_PULL_URL_INVALID"],
    [403, "FORBIDDEN_CAPABILITY"],
    [429, "TOO_MANY_REQUESTS"],
  ] as const) {
    const out = interpretPullResponse(status, { code, error: "English prose from the server" });
    assert.deepEqual(out, { ok: false, code });
    assert.equal(JSON.stringify(out).includes("English prose"), false);
  }
  assert.deepEqual(interpretPullResponse(500, null), { ok: false, code: null });
  const pull = { url: "https://a.example/feed", hasSecret: true, cursor: null };
  assert.deepEqual(interpretPullResponse(200, { pull }), { ok: true, pull });
  assert.deepEqual(interpretPullResponse(200, {}), { ok: false, code: null }, "a 200 without the envelope is not a save");

  // The card resolves that code through useErrorMessage and never renders `.error`.
  const card = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ChannelsReceiverPullCard.tsx"), "utf8");
  assert.match(card, /useErrorMessage\(\)/);
  assert.match(card, /interpretPullResponse\(/);
  assert.match(card, /errMsg\(outcome,/, "the refusal is localized from its code");
  assert.doesNotMatch(card, /\.error\b/, "the server's error string is never read");
});
