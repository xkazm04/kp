// The Claude CLI SimLlm's plumbing (spark interview-uat-tranche, WP-1) — everything that
// can be pinned without spawning the CLI: the billing-key strip, the KP_OFFLINE refusal,
// the one-shot rendering of a conversation and the envelope parse.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  claudeChildEnv,
  claudeCliLlm,
  OFFLINE_REFUSAL,
  parseCliEnvelope,
  renderConversation,
  SimProviderError,
  STRIPPED_API_KEY_ENV,
  STRIPPED_SESSION_ENV,
} from "./providers.ts";

test("the child bills the subscription: API keys and session-nesting markers never reach it", () => {
  const parent = { PATH: "/bin", ANTHROPIC_API_KEY: "sk-x", ANTHROPIC_AUTH_TOKEN: "t", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SIMPLE: "1", KEEP: "yes" };
  const env = claudeChildEnv(parent);
  for (const k of [...STRIPPED_API_KEY_ENV, ...STRIPPED_SESSION_ENV]) assert.equal(env[k], undefined, k);
  assert.equal(env.PATH, "/bin");
  assert.equal(env.KEEP, "yes");
  assert.equal(parent.ANTHROPIC_API_KEY, "sk-x", "the parent environment is not mutated");
});

test("under KP_OFFLINE the CLI provider refuses at construction — before looking for the binary", () => {
  const before = process.env.KP_OFFLINE;
  process.env.KP_OFFLINE = "1";
  try {
    assert.throws(() => claudeCliLlm({ command: "definitely-not-a-real-claude-binary" }), (err: unknown) => err instanceof SimProviderError && err.message === OFFLINE_REFUSAL);
  } finally {
    if (before === undefined) delete process.env.KP_OFFLINE;
    else process.env.KP_OFFLINE = before;
  }
});

test("a missing CLI is a clear provider error, not a crash", () => {
  const before = process.env.KP_OFFLINE;
  delete process.env.KP_OFFLINE;
  try {
    assert.throws(() => claudeCliLlm({ command: "definitely-not-a-real-claude-binary" }), SimProviderError);
  } finally {
    if (before !== undefined) process.env.KP_OFFLINE = before;
  }
});

test("a conversation renders every turn in order and asks for the next assistant turn only", () => {
  const text = renderConversation([
    { role: "user", content: "(The call is connected.)" },
    { role: "assistant", content: "Hello." },
    { role: "user", content: "Candidate: Hi." },
  ]);
  assert.ok(text.indexOf('<turn role="user">\n(The call is connected.)') < text.indexOf('<turn role="assistant">\nHello.'));
  assert.ok(text.indexOf('<turn role="assistant">\nHello.') < text.indexOf("Candidate: Hi."));
  assert.match(text, /Write the next assistant turn/);
});

test("the envelope parse returns the result, unwraps an echoed turn tag, and refuses errors", () => {
  assert.equal(parseCliEnvelope(JSON.stringify({ subtype: "success", result: "Hi there." }), "", 0), "Hi there.");
  assert.equal(parseCliEnvelope(JSON.stringify({ subtype: "success", result: '<turn role="assistant">\nHi.\n</turn>' }), "", 0), "Hi.");
  assert.throws(() => parseCliEnvelope(JSON.stringify({ subtype: "error_max_turns", is_error: true, result: "x" }), "", 1), SimProviderError);
  assert.throws(() => parseCliEnvelope("not json", "", 0), SimProviderError);
  assert.throws(() => parseCliEnvelope("", "boom", 1), SimProviderError);
});
