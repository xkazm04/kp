// The TS half of the Activity row-detail join key: an ambient task id must reach
// the spawned child as KP_LLM_REQUEST_ID, so Python's monitor can stamp it onto
// every ledger line (pipeline/jobfit/llm/monitor.py — the Python half is covered
// by test_llm_monitor.py's request-id cases).
//
// The risk this pins is AsyncLocalStorage propagation, not string concatenation:
// spawnPython is reached several async frames below the task runner, so the store
// has to survive the awaits in between. The test therefore spawns through a real
// await boundary rather than reading currentLlmRequestId() inline.
//
// Hermetic, following python-runner-stdin.test.ts: `node` stands in for
// PYTHON_CMD, so no Python toolchain is needed and the child can just print the
// env var back.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.PYTHON_CMD = process.execPath;
const { spawnPython } = await import("./python-runner.ts");
const { withLlmRequestId, currentLlmRequestId } = await import("./llm-request-context.ts");

// Prints the inherited request id (or the literal "unset") and exits.
const ECHO = "process.stdout.write(process.env.KP_LLM_REQUEST_ID ?? 'unset');process.exit(0);";

/** Spawn after an await, so the store must have crossed an async boundary. */
async function spawnAfterAwait(): Promise<string> {
  await new Promise((r) => setTimeout(r, 1));
  const { result } = spawnPython(["-e", ECHO], { timeoutMs: 8000 });
  const { stdout } = await result;
  return stdout.trim();
}

test("the ambient request id reaches the child across async boundaries", async () => {
  const got = await withLlmRequestId("t_abc123", () => spawnAfterAwait());
  assert.equal(got, "t_abc123");
});

test("a spawn outside any scope inherits no request id", async () => {
  // The degraded case that must stay degraded: an inline route or a direct CLI
  // run writes a null request_id, exactly as the ledger always did. A leaked
  // value here would misattribute the row to an unrelated run.
  delete process.env.KP_LLM_REQUEST_ID;
  assert.equal(currentLlmRequestId(), null);
  assert.equal(await spawnAfterAwait(), "unset");
});

test("scopes do not leak into a sibling spawn that runs after them", async () => {
  await withLlmRequestId("t_first", () => spawnAfterAwait());
  assert.equal(currentLlmRequestId(), null);
  assert.equal(await spawnAfterAwait(), "unset");
});

test("a nested scope wins over the one enclosing it", async () => {
  const got = await withLlmRequestId("t_outer", async () => {
    assert.equal(currentLlmRequestId(), "t_outer");
    return withLlmRequestId("t_inner", () => spawnAfterAwait());
  });
  assert.equal(got, "t_inner");
});
