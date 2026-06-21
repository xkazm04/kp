// Locks the secret scrubber that stands between a provider-SDK error tail and the
// Models "Test" panel: known key shapes must never survive into the forwarded
// message, while the surrounding diagnostic text is preserved.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets } from "./redact-secrets.ts";

test("redacts Anthropic / OpenAI / Google keys", () => {
  assert.equal(redactSecrets("key sk-ant-api03-AbC123_def-XYZ failed"), "key sk-ant-*** failed");
  assert.equal(redactSecrets("Authorization: sk-proj-abcd1234EFGH"), "Authorization: sk-***");
  assert.equal(redactSecrets("google AIzaSyA1b2C3d4E5f6G7h8 used"), "google AIza*** used");
});

test("redacts bearer tokens, api-key fields, and KP_LLM_CONFIG", () => {
  assert.equal(redactSecrets("Bearer eyJhbG.payload.sig"), "Bearer ***");
  assert.match(redactSecrets('{"apiKey":"hunter2secret"}'), /"apiKey":"\*\*\*/);
  assert.equal(redactSecrets("env KP_LLM_CONFIG={\"keys\":1} oops"), "env KP_LLM_CONFIG=*** oops");
});

test("preserves benign diagnostic text", () => {
  const msg = "AuthenticationError: the model gpt-4o-mini is not available for this key";
  assert.equal(redactSecrets(msg), msg);
});
