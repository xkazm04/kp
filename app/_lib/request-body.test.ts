// The body cap is the only thing standing between an anonymous caller and this
// process's heap on every public token route. It has to hold when the caller LIES:
// content-length is attacker-controlled, so a cap enforced on the header alone is
// not a cap at all — it is a cap on honest clients.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { BODY_TOO_LARGE, readJsonWithLimit, readTextWithLimit } from "./request-body.ts";

/** A request whose declared content-length can be set independently of what it streams. */
function req(body: string, declared?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (declared !== undefined) headers.set("content-length", declared);
  return new Request("https://kp.test/api/x", { method: "POST", body, headers });
}

test("a body under the cap reads back whole", async () => {
  assert.equal(await readTextWithLimit(req("hello"), 64), "hello");
});

test("a body over the cap returns null — measured on the bytes, not the header", async () => {
  // The header says 5; the stream carries 5000. Only the wire measurement can catch it.
  assert.equal(await readTextWithLimit(req("x".repeat(5000), "5"), 64), null);
});

test("multi-byte characters are counted as BYTES, not as characters", async () => {
  // 40 code points, 120 bytes in UTF-8. A char-length cap would wave this through.
  const text = "€".repeat(40);
  assert.equal(await readTextWithLimit(req(text), 64), null);
  assert.equal(await readTextWithLimit(req(text), 200), text);
});

test("an absent body is the empty string, not a failure", async () => {
  assert.equal(await readTextWithLimit(new Request("https://kp.test/x", { method: "POST" }), 64), "");
});

test("readJsonWithLimit: the parsed value, the fallback, or BODY_TOO_LARGE", async () => {
  assert.deepEqual(await readJsonWithLimit(req('{"a":1}'), 64, {}), { a: 1 });
  assert.deepEqual(await readJsonWithLimit(req("not json at all"), 64, { d: true }), { d: true });
  assert.deepEqual(await readJsonWithLimit(req(""), 64, { d: true }), { d: true });
  assert.equal(await readJsonWithLimit(req("x".repeat(5000), "5"), 64, {}), BODY_TOO_LARGE);
});

test("readJsonWithLimit: a literal `null` body yields the fallback, never null", async () => {
  // `JSON.parse("null")` is valid. A route that then reads `body.token` off it would
  // throw a TypeError inside its own try — a 500 for a two-byte request.
  assert.deepEqual(await readJsonWithLimit(req("null"), 64, { token: "" }), { token: "" });
});

test("an honest oversized content-length is refused without reading the stream", async () => {
  assert.equal(await readJsonWithLimit(req("{}", String(10 * 1024)), 64, {}), BODY_TOO_LARGE);
});

test("BODY_TOO_LARGE is a value no body can produce", () => {
  assert.equal(typeof BODY_TOO_LARGE, "symbol");
  assert.notEqual(BODY_TOO_LARGE, Symbol("kp.body-too-large"));
});
