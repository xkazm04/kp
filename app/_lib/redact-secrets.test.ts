// Locks the secret scrubber that stands between a provider-SDK error tail and the
// Models "Test" panel: known key shapes must never survive into the forwarded
// message, while the surrounding diagnostic text is preserved.
//
// The second half is a LOCKSTEP against `scripts/security/secret-scan.mjs`. That
// table is the repository's own answer to "what does a credential look like", and
// the redactor used to know six of its shapes — so an AWS access key id, a GitHub
// token, a Slack token or an ElevenLabs key reached the Test panel unredacted while
// the same bytes would have failed the commit that leaked them. The test reads the
// scan source, rebuilds every row's regex, and proves each shape is BOTH a genuine
// instance of the scan's rule AND scrubbed here — so a row added to the scan table
// fails this test until the redactor learns it.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { redactSecrets, SECRET_SHAPE_IDS } from "./redact-secrets.ts";

test("redacts Anthropic / OpenAI / Google keys", () => {
  assert.equal(redactSecrets("key sk-ant-api03-AbC123_def-XYZ failed"), "key sk-ant-*** failed");
  assert.equal(redactSecrets("Authorization: sk-proj-abcd1234EFGH"), "Authorization: sk-proj-***");
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

// --- lockstep with scripts/security/secret-scan.mjs ------------------------------

/**
 * One representative instance per scan row, ASSEMBLED AT RUNTIME rather than
 * written as a literal: a key-shaped literal committed in a file under `app/` is a
 * leaked key as far as `npm run security:secrets` is concerned (that scanner exempts
 * only `scripts/security/**`, deliberately — see its SECRET_EXEMPT note), so this
 * file must not contain one. Every sample is verified against the scan's OWN regex
 * below, which is what makes the assembly honest instead of merely evasive.
 */
const FILL = "aB3dEf7hJk2mNp5rSt8vWx1yZ4cQ6uGi0lOe9nRb";
const HEX = "0123456789abcdef0123456789abcdef0123456789abcdef";
const UPPER = "ABCDEFGHIJKLMNOP0123456789";

const SAMPLES: Record<string, string> = {
  anthropic: "sk-" + "ant-api03-" + FILL,
  "openai-project": "sk-" + "proj-" + FILL,
  "openai-legacy": "sk-" + FILL.slice(0, 40) + "aB3dEf7h",
  openrouter: "sk-" + "or-v1-" + HEX.slice(0, 32),
  elevenlabs: "sk" + "_" + HEX.slice(0, 40),
  google: "AI" + "za" + FILL.slice(0, 35),
  "gcp-service-account": '"type"' + ': "service_account"',
  aws: "AK" + "IA" + UPPER.slice(0, 16),
  github: "gh" + "p_" + FILL.slice(0, 36),
  "github-fine-grained": "github" + "_pat_" + FILL + FILL.slice(0, 20),
  npm: "npm" + "_" + FILL.slice(0, 36),
  slack: "xo" + "xb-" + FILL.slice(0, 24),
  "private-key": "-----BEGIN " + "RSA PRIVATE KEY-----",
};

/** The scan table as data: `[id, RegExp]` per row, parsed from the source of truth. */
function scanRows(): Array<[string, RegExp]> {
  const src = readFileSync(
    fileURLToPath(new URL("../../scripts/security/secret-scan.mjs", import.meta.url)),
    "utf8"
    // CRLF checkout vs LF worktree: normalise before any anchored matching.
  ).replace(/\r\n/g, "\n");
  const start = src.indexOf("export const SECRET_PATTERNS");
  assert.ok(start > 0, "secret-scan.mjs must still export SECRET_PATTERNS");
  const table = src.slice(start, src.indexOf("\n];", start));
  const rows: Array<[string, RegExp]> = [];
  for (const m of table.matchAll(/\bid:\s*'([^']+)'[\s\S]{0,80}?\bre:\s*(\/(?:\\.|\[(?:\\.|[^\]])*\]|[^/\\])+\/)/g)) {
    const body = m[2].slice(1, -1);
    rows.push([m[1], new RegExp(body)]);
  }
  return rows;
}

test("every secret-scan shape has a redactor shape (lockstep, both directions)", () => {
  const rows = scanRows();
  assert.ok(rows.length >= 13, `expected the full scan table, parsed ${rows.length} rows`);
  const scanIds = rows.map(([id]) => id).sort();
  const covered = SECRET_SHAPE_IDS.filter((id) => scanIds.includes(id)).sort();
  assert.deepEqual(
    covered,
    scanIds,
    "a row in scripts/security/secret-scan.mjs has no counterpart in redact-secrets.ts — " +
      "the scan would block that shape at commit time while the Models Test panel forwards it"
  );
});

test("each secret-scan shape is redacted out of a diagnostic message", () => {
  for (const [id, re] of scanRows()) {
    const sample = SAMPLES[id];
    assert.ok(sample, `no sample for scan row "${id}" — add one to SAMPLES`);
    assert.match(sample, re, `the "${id}" sample is not actually an instance of the scan's own rule`);
    const out = redactSecrets(`ProviderError: refused with ${sample} (host acme.example.com)`);
    assert.ok(!out.includes(sample), `the "${id}" shape survived redactSecrets`);
    assert.ok(out.includes("***"), `the "${id}" redaction left no marker`);
    assert.ok(out.includes("acme.example.com"), `the "${id}" redaction ate the surrounding diagnostic`);
  }
});
