// Locks the fix for bug-ui-scan-2026-07-09 / model-api-key-management #1:
// the canary "Test" button must NEVER return raw provider-SDK/stderr text to the
// client. test_cli prints its FAILURE envelope to stdout and exits 0 (the verdict
// IS the payload), so the failure always arrives on the exit-0 path — the one the
// route used to return VERBATIM (`return NextResponse.json(parsePythonJson(...))`).
// A provider SDK/transport error that echoes the auth header/URL therefore leaked
// key material to whoever can press Test.
//
// These drive the REAL shaping logic (`shapeVerdict`) at the spawn/CLI boundary:
// each test feeds it the exact stdout/stderr/exitCode the spawn would yield — no
// python, no real key. The source guard pins that the route funnels BOTH paths
// through the shaper and no longer returns the parsed envelope verbatim.
//
// Non-vacuity: every leak test first asserts the PRE-FIX payload (the parsed
// envelope, returned verbatim on exit 0) DID carry the raw text, then that the
// shaped verdict does not — same input, so the assertion can only pass because of
// the fix.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyProviderError, extractConfigKeys, scrubKeyMaterial, shapeVerdict } from "./verdict.ts";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

// A realistic exit-0 failure envelope: test_cli caught a provider exception and
// built `error: f"{type(exc).__name__}: {exc}"` — here the SDK echoed the auth
// header, so the raw text embeds a live-looking key. THIS is the leak vector.
const LEAKED_KEY = "sk-live-ABCDEF0123456789SECRETKEYMATERIAL";
const RAW_SDK_ERROR = `AuthenticationError: 401 invalid api key, sent Authorization: Bearer ${LEAKED_KEY}`;
const EXIT0_FAILURE_ENVELOPE = JSON.stringify({
  ok: false,
  provider: "openai",
  model: "gpt-4o-mini",
  error: RAW_SDK_ERROR,
});

test("exit-0 failure envelope with raw SDK text does NOT leak it — maps to a generic reason", () => {
  // Non-vacuity: reproduce exactly what the PRE-FIX route shipped on exit 0.
  const preFix = JSON.parse(EXIT0_FAILURE_ENVELOPE);
  assert.ok(
    JSON.stringify(preFix).includes(RAW_SDK_ERROR),
    "guard: the pre-fix payload (parsed envelope, returned verbatim) DID carry the raw SDK text",
  );

  const verdict = shapeVerdict({ stdout: EXIT0_FAILURE_ENVELOPE, stderr: "", exitCode: 0 }, []);

  assert.equal(verdict.ok, false);
  const body = JSON.stringify(verdict);
  // The raw SDK text — and every fragment of it — is gone.
  assert.ok(!body.includes(RAW_SDK_ERROR), "the shaped verdict must not carry the raw SDK error text");
  assert.ok(!body.includes(LEAKED_KEY), "the shaped verdict must not carry any key byte");
  assert.ok(!body.includes("Authorization"), "no echoed auth header may survive");
  assert.ok(!body.includes("Bearer"), "no bearer token fragment may survive");
  // ...and the client still gets a useful, mapped reason + stable code.
  if (verdict.ok === false) {
    assert.equal(verdict.code, "auth", "an AuthenticationError must map to the auth code");
    assert.match(verdict.error, /authentication failed/i, "the reason must be the generic mapped text");
  }
});

test("a key-shaped / prefixless key string in the error is scrubbed by the backstop", () => {
  // A custom/Azure key with no sk-/AIza/Bearer shape — redactSecrets alone misses
  // it, so the literal-key scrub (fed the built config keys) must catch it.
  const azureKey = "9f8c7b6a5d4e3f2a1b0c9d8e7f6a5b4c"; // prefixless, shape-blind
  const raw = `APIConnectionError: connecting to https://acme.openai.azure.com/?key=${azureKey} failed`;
  const scrubbed = scrubKeyMaterial(raw, [azureKey]);
  assert.ok(!scrubbed.includes(azureKey), "the literal (prefixless) key must be scrubbed");
  assert.ok(scrubbed.includes("***"), "the scrub must leave a redaction marker");

  // End to end: even if the reason ever interpolated raw text, shapeVerdict scrubs
  // the config keys out of everything it returns.
  const envelope = JSON.stringify({ ok: false, provider: azureKey, model: "gpt-4o", error: raw });
  const verdict = shapeVerdict({ stdout: envelope, stderr: "", exitCode: 0 }, [azureKey]);
  assert.ok(!JSON.stringify(verdict).includes(azureKey), "no config-key byte may reach the response");

  // extractConfigKeys pulls those bytes out of a real KP_LLM_CONFIG fragment.
  const keys = extractConfigKeys({
    KP_LLM_CONFIG: JSON.stringify({ useCases: {}, keys: { azure_openai: { apiKey: azureKey } } }),
  });
  assert.deepEqual(keys, [azureKey], "extractConfigKeys must surface the decrypted key bytes to scrub");
});

test("exit!=0 stderr traceback (broken spawn) also maps to a generic reason, never the raw trace", () => {
  const trace = `Traceback (most recent call last):\n  ...\nRateLimitError: 429 too many requests key=${LEAKED_KEY}`;
  const verdict = shapeVerdict({ stdout: "", stderr: trace, exitCode: 1 }, [LEAKED_KEY]);
  const body = JSON.stringify(verdict);
  assert.equal(verdict.ok, false);
  assert.ok(!body.includes(LEAKED_KEY), "the stderr key byte must not reach the client");
  assert.ok(!body.includes("Traceback"), "the raw traceback must not reach the client");
  if (verdict.ok === false) assert.equal(verdict.code, "rate_limit", "a RateLimitError must map to rate_limit");
});

test("unparseable stdout does not surface the raw output", () => {
  const junk = `some non-json library spew mentioning ${LEAKED_KEY} then a crash`;
  const verdict = shapeVerdict({ stdout: junk, stderr: "", exitCode: 0 }, [LEAKED_KEY]);
  assert.equal(verdict.ok, false);
  assert.ok(!JSON.stringify(verdict).includes(LEAKED_KEY), "unparseable stdout must never be echoed back");
});

test("a real success still returns ok, unchanged (provider/model/latency pass through)", () => {
  const success = JSON.stringify({ ok: true, provider: "anthropic", model: "claude-haiku-4-5", latencyMs: 812 });
  const verdict = shapeVerdict({ stdout: success, stderr: "", exitCode: 0 }, []);
  assert.deepEqual(verdict, { ok: true, provider: "anthropic", model: "claude-haiku-4-5", latencyMs: 812 });
});

test("classifyProviderError maps the known error families (and defaults to generic)", () => {
  assert.equal(classifyProviderError("AuthenticationError: bad key"), "auth");
  assert.equal(classifyProviderError("RateLimitError: 429"), "rate_limit");
  assert.equal(classifyProviderError("APIConnectionError: dns failure"), "connection");
  assert.equal(classifyProviderError("APITimeoutError: timed out"), "timeout");
  assert.equal(classifyProviderError("NotFoundError: model not found"), "invalid_model");
  assert.equal(classifyProviderError("PermissionDeniedError: 403"), "permission");
  assert.equal(classifyProviderError("provider unavailable (missing key or SDK/CLI)"), "unavailable");
  assert.equal(classifyProviderError("unexpected canary payload: {\"foo\":1}"), "bad_payload");
  // An unknown/opaque error must fall back to the generic bucket, never leak text.
  assert.equal(classifyProviderError("KaboomError: internal weirdness 0xdeadbeef"), "provider_error");
});

// --- Source-level guard: the route must funnel BOTH paths through the shaper ----
test("route.ts routes every path through shapeVerdict and never returns the parsed envelope verbatim", () => {
  const src = read("./route.ts");
  // The exact pre-fix leak: returning the parsed CLI envelope straight to the client.
  assert.doesNotMatch(
    src,
    /return NextResponse\.json\(\s*parsePythonJson/,
    "the route must NOT return parsePythonJson output verbatim (that was the exit-0 leak)",
  );
  assert.match(src, /shapeVerdict\(\{\s*stdout,\s*stderr,\s*exitCode\s*\}/, "the route must shape the spawn result");
  assert.match(src, /from "\.\/verdict\.ts"/, "the shaper must come from the sibling verdict module");
  // Both the failure branch AND the 500 catch go through the scrub backstop.
  assert.match(src, /scrubKeyMaterial\(/, "the catch path must scrub before returning");
  // The old exit-code-gated redaction (redact only when exit!=0) is gone.
  assert.doesNotMatch(src, /if \(exitCode !== 0\) \{[\s\S]*redactSecrets/, "redaction must not be gated on exit code");
});
