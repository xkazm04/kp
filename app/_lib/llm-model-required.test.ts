// Lockstep: MODEL_REQUIRED_PROVIDERS (TS) must match the providers whose
// DEFAULT_MODELS entry is None in capabilities.py (Python), minus claude_cli.
//
// The two lists are hand-mirrored by design — Python is authoritative and the TS
// copy only shapes what the admin UI asks for — but a hand-mirrored list rots.
// The failure it rots INTO is quiet and bad: adding a provider with no built-in
// default and forgetting this list makes the keys panel fire a probe with no
// model, which comes back as a generic "invalid model or request" that reads as
// "your key is broken". Reading the Python source keeps that honest without
// running Python.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_REQUIRED_PROVIDERS } from "./llm-model-defaults.ts";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAPABILITIES = path.join(REPO_ROOT, "pipeline", "jobfit", "llm", "capabilities.py");

/** The `DEFAULT_MODELS` dict body, parsed to { provider: hasDefault }. */
function defaultModelsFromPython(): Record<string, boolean> {
  const source = readFileSync(CAPABILITIES, "utf-8");
  const block = source.match(/DEFAULT_MODELS: dict\[str, str \| None\] = \{([\s\S]*?)\n\}/);
  assert.ok(block, "DEFAULT_MODELS block not found in capabilities.py — did the declaration change shape?");
  const out: Record<string, boolean> = {};
  for (const line of block[1].split("\n")) {
    const entry = line.match(/^\s*"([a-z_]+)"\s*:\s*(None|"[^"]*")/);
    if (entry) out[entry[1]] = entry[2] !== "None";
  }
  return out;
}

test("capabilities.py still declares DEFAULT_MODELS in the shape this test reads", () => {
  const defaults = defaultModelsFromPython();
  // A sanity floor: if the parse silently produced nothing, every assertion below
  // would pass vacuously.
  assert.ok(Object.keys(defaults).length >= 6, `parsed only ${Object.keys(defaults).length} providers`);
  assert.equal(defaults["anthropic"], true, "anthropic should carry a built-in default");
});

test("MODEL_REQUIRED_PROVIDERS matches the Python providers with no default model", () => {
  const defaults = defaultModelsFromPython();
  const expected = Object.entries(defaults)
    .filter(([provider, hasDefault]) => !hasDefault && provider !== "claude_cli")
    .map(([provider]) => provider)
    .sort();
  assert.deepEqual([...MODEL_REQUIRED_PROVIDERS].sort(), expected);
});

test("claude_cli is excluded deliberately: its None means the CLI's own default", () => {
  const defaults = defaultModelsFromPython();
  assert.equal(defaults["claude_cli"], false, "claude_cli should still be None in DEFAULT_MODELS");
  assert.ok(!(MODEL_REQUIRED_PROVIDERS as readonly string[]).includes("claude_cli"));
});
