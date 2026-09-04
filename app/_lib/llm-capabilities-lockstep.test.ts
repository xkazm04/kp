// Lockstep: the TS provider / use-case / bench-op catalogs must match the Python
// declarations they mirror. Python is authoritative — the TS copies exist only to
// gate what the admin API accepts and what the Models tab offers.
//
// WHY THIS FILE. llm-model-required.test.ts already reads capabilities.py to keep
// MODEL_REQUIRED_PROVIDERS honest, and its header explains the failure a
// hand-mirrored list rots into. That reasoning applies to three more mirrors that
// had no guard at all:
//
//   LLM_PROVIDERS  <- PROVIDER_CAPABILITIES  (capabilities.py)
//   LLM_USE_CASES  <- USE_CASE_REQUIREMENTS  (capabilities.py)
//   BENCH_OPS      <- REGISTRY_USE_CASE      (bench/scenarios.py)
//
// Each rots quietly and in a direction the type system cannot see:
//
//   • a provider Python gained and TS did not => isLlmProvider rejects it, so the
//     provider cannot be configured from Settings at all, while Python would have
//     served it. The operator reads "Unknown provider." about a provider that works.
//   • a use case Python gained and TS did not => PUT /api/llm/config 400s
//     ("Unknown useCase."), so that use case can never be routed or re-modelled and
//     silently runs on the default provider forever.
//   • a use case TS has and Python does not => the admin accepts a routing row that
//     resolve_provider never reads. The Models tab shows a pin that does nothing.
//   • a bench op whose routing use case is not a real use case => opsForUseCase()
//     returns [] and bestModelForUseCase() returns null, so the Models tab quietly
//     shows no recommendation for that use case — the one thing the scorecard exists
//     to provide.
//
// Reading the Python source keeps all of that honest without running Python.
//
// NOTE for the next reader: llm-config.ts IS importable here. It pulls in ./db/llm,
// but that store opens SQLite lazily inside ensureDb(), so nothing touches
// better-sqlite3 at module-eval time. (llm-model-defaults.ts's header claimed
// otherwise; corrected in the same change as this file. The browser half of that
// claim still stands — better-sqlite3 cannot bundle for a client component.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LLM_PROVIDERS, LLM_USE_CASES } from "./llm-config.ts";
import { BENCH_OPS } from "./llm-quality.ts";
import { TRANSIENT_HTTP_CODES, TRANSIENT_MARKERS } from "./gemini-retry.ts";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAPABILITIES = path.join(REPO_ROOT, "pipeline", "jobfit", "llm", "capabilities.py");
const SCENARIOS = path.join(REPO_ROOT, "pipeline", "jobfit", "llm", "bench", "scenarios.py");
const BASE = path.join(REPO_ROOT, "pipeline", "jobfit", "llm", "base.py");
const MONITOR = path.join(REPO_ROOT, "pipeline", "jobfit", "llm", "monitor.py");
// Three more mirrors live in modules this test must NOT import: llm-lighttrack.ts
// resolves env at import time and llm-quality.ts is client-safe, and both keep
// their tables module-private on purpose. Reading them as SOURCE pins the mirror
// without widening either module's public surface.
const LIGHTTRACK_TS = path.join(REPO_ROOT, "app", "_lib", "llm-lighttrack.ts");
const QUALITY_TS = path.join(REPO_ROOT, "app", "_lib", "llm-quality.ts");

/** The `"key": "value"` pairs of an object/dict literal declared as `declaration`
 *  (same literal shape in TS and Python, so one reader serves both). */
function stringMap(file: string, declaration: string, closer = "}"): Record<string, string> {
  const source = readFileSync(file, "utf-8");
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} not found in ${path.basename(file)} - did it move or get renamed?`);
  const open = source.indexOf("{", start);
  const close = source.indexOf(closer, open);
  assert.ok(open !== -1 && close > open, `${declaration} is not an object literal any more`);
  const body = source.slice(open, close);
  const out: Record<string, string> = {};
  for (const match of body.matchAll(/(?:^|[{,])\s*"?([a-z_]+)"?\s*:\s*"([a-zA-Z0-9_.-]+)"/gm)) out[match[1]] = match[2];
  return out;
}

/** The keys of a top-level Python dict literal, in declaration order.
 *  `declaration` is matched literally up to the opening brace, so a renamed or
 *  re-shaped declaration fails the shape guard below rather than silently
 *  returning an empty list. */
function pythonDictKeys(file: string, declaration: string): string[] {
  const source = readFileSync(file, "utf-8");
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} not found in ${path.basename(file)} — did the declaration change shape?`);
  const open = source.indexOf("{", start);
  const close = source.indexOf("\n}", open);
  assert.ok(open !== -1 && close > open, `${declaration} is not a brace-delimited dict any more`);
  const body = source.slice(open, close);
  // Keys only: a quoted string at the start of a line, followed by a colon.
  // Comment lines inside these dicts are prose and never match.
  return [...body.matchAll(/^\s*"([a-z_]+)"\s*:/gm)].map((m) => m[1]);
}

// The anti-vacuity floor. Every assertion below compares against a PARSED list,
// so a parse that silently produced nothing would make all of them pass while
// proving the opposite of what they claim.
test("the Python declarations still have the shape this test reads", () => {
  const providers = pythonDictKeys(CAPABILITIES, "PROVIDER_CAPABILITIES");
  const useCases = pythonDictKeys(CAPABILITIES, "USE_CASE_REQUIREMENTS");
  const benchOps = pythonDictKeys(SCENARIOS, "REGISTRY_USE_CASE");
  assert.ok(providers.length >= 6, `parsed only ${providers.length} providers from PROVIDER_CAPABILITIES`);
  assert.ok(useCases.length >= 20, `parsed only ${useCases.length} use cases from USE_CASE_REQUIREMENTS`);
  assert.ok(benchOps.length >= 10, `parsed only ${benchOps.length} bench ops from REGISTRY_USE_CASE`);
  assert.ok(providers.includes("anthropic"), "anthropic should be a declared provider");
  assert.ok(useCases.includes("match_reasoning"), "match_reasoning should be a declared use case");
});

test("LLM_PROVIDERS matches PROVIDER_CAPABILITIES exactly", () => {
  assert.deepEqual(
    [...LLM_PROVIDERS].sort(),
    pythonDictKeys(CAPABILITIES, "PROVIDER_CAPABILITIES").sort(),
    "a provider TS does not know cannot be configured from Settings; one Python does not know is a route that never applies"
  );
});

test("LLM_USE_CASES matches USE_CASE_REQUIREMENTS exactly, plus the '*' wildcard", () => {
  // "*" is TS-only on purpose: it is the routing catch-all the admin UI offers
  // (llm-config.configuredModelFor falls back to it), not a use case Python resolves.
  const declared = [...LLM_USE_CASES];
  assert.ok(declared.includes("*"), "the wildcard row must stay offerable");
  assert.deepEqual(
    declared.filter((u) => u !== "*").sort(),
    pythonDictKeys(CAPABILITIES, "USE_CASE_REQUIREMENTS").sort()
  );
});

test("BENCH_OPS matches REGISTRY_USE_CASE — both the op ids and what each rolls up to", () => {
  const source = readFileSync(SCENARIOS, "utf-8");
  const start = source.indexOf("REGISTRY_USE_CASE");
  const body = source.slice(source.indexOf("{", start), source.indexOf("\n}", start));
  const pythonPairs = [...body.matchAll(/^\s*"([a-z_]+)"\s*:\s*"([a-z_]+)"/gm)].map(([, op, useCase]) => `${op}=${useCase}`);
  assert.ok(pythonPairs.length >= 10, `parsed only ${pythonPairs.length} pairs from REGISTRY_USE_CASE`);
  // The MAPPING, not just the ids: several comms ops roll up into "automation",
  // and getting that rollup wrong silently changes which measurements back a
  // published recommendation.
  assert.deepEqual(BENCH_OPS.map((o) => `${o.id}=${o.useCase}`).sort(), pythonPairs.sort());
});

test("every bench op rolls up to a use case that actually exists", () => {
  // BenchOp.useCase is typed `string` (llm-quality.ts is client-safe and does not
  // import the union), so only this assertion stops a typo from becoming an empty
  // recommendation on the Models tab.
  const known = new Set<string>(LLM_USE_CASES);
  for (const op of BENCH_OPS) {
    assert.ok(known.has(op.useCase), `bench op ${op.id} rolls up to "${op.useCase}", which is not an LLM use case`);
  }
});

// ---------------------------------------------------------------------------
// Three MORE hand-mirrors, each carrying a header that ASKS for sync and, until
// now, no test doing the asking. Same failure mode as the catalogs above: silent,
// and in a direction neither the type system nor any other test can see.
// ---------------------------------------------------------------------------

/** The string / 3-digit-int literals between `opener` and `closer` after `marker`. */
function pythonLiterals(file: string, marker: string, opener: string, closer: string): string[] {
  const source = readFileSync(file, "utf-8");
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${marker} not found in ${path.basename(file)} - did it change shape?`);
  const open = source.indexOf(opener, start);
  const close = source.indexOf(closer, open);
  assert.ok(open !== -1 && close > open, `${marker} is not delimited by ${opener} ... ${closer} any more`);
  return [...source.slice(open, close).matchAll(/"([^"]+)"|\b(\d{3})\b/g)].map((m) => m[1] ?? m[2]);
}

test("gemini-retry's transient HTTP codes match base.py is_transient_error", () => {
  // A code Python retries and TS does not = the github-analysis review hard-fails on
  // a blip every other kp call rides out; the reverse burns attempts on a permanent
  // error. Neither is visible in a type, and no other test reads both sides.
  const python = pythonLiterals(BASE, "def is_transient_error", "{408", "}").map(Number);
  assert.ok(python.length >= 5, `parsed only ${python.length} status codes from is_transient_error`);
  assert.deepEqual([...TRANSIENT_HTTP_CODES].sort(), python.sort());
});

test("gemini-retry's transient message markers match base.py is_transient_error", () => {
  const python = pythonLiterals(BASE, "def is_transient_error", "for marker in (", ")");
  assert.ok(python.length >= 10, `parsed only ${python.length} markers from is_transient_error`);
  assert.deepEqual([...TRANSIENT_MARKERS].sort(), python.sort());
});

test("the LightTrack alias table folds every provider monitor.py folds, the same way", () => {
  const aliases = stringMap(LIGHTTRACK_TS, "const PROVIDER_ALIASES", "};");
  assert.ok(Object.keys(aliases).length >= 5, `parsed only ${Object.keys(aliases).length} aliases`);
  // monitor.py's _TRACK_PROVIDER is the authoritative fold (LightTrack's SDK does the
  // vendor ones itself). A pair Python folds and TS does not means TS-direct spend
  // lands in a bucket the Python spend for the SAME credential never uses.
  const python = stringMap(MONITOR, "_TRACK_PROVIDER = ");
  assert.ok(Object.keys(python).length >= 1, "parsed no pairs from _TRACK_PROVIDER");
  for (const [provider, bucket] of Object.entries(python)) {
    assert.equal(aliases[provider], bucket, `TS must fold ${provider} -> ${bucket} like monitor.py does`);
  }
  // Normalizing twice must not move the bucket: every target is itself a key mapping
  // to itself. Without this, a future `google: "gemini"` row would split one vendor's
  // spend by which spelling the call site happened to use.
  for (const bucket of new Set(Object.values(aliases))) {
    assert.equal(aliases[bucket], bucket, `"${bucket}" is an alias target, so it must map to itself`);
  }
  // Every kp provider id in the table must be one Python declares - a rename on the
  // Python side otherwise leaves an alias row that can never match again.
  const declared = new Set(pythonDictKeys(CAPABILITIES, "PROVIDER_CAPABILITIES"));
  // Non-kp spellings deliberately carried so an SDK-shaped provider string still folds.
  const SDK_SPELLINGS = new Set(["google", "vertex", "claude", "openai", "anthropic"]);
  for (const provider of Object.keys(aliases)) {
    assert.ok(
      declared.has(provider) || SDK_SPELLINGS.has(provider),
      `alias row "${provider}" is neither a declared provider nor a known SDK spelling`
    );
  }
});

test("the matrix prefix table covers every direct-vendor default and agrees with the alias table", () => {
  const prefixes = stringMap(QUALITY_TS, "const PROVIDER_PREFIX", "};");
  const declared = new Set(pythonDictKeys(CAPABILITIES, "PROVIDER_CAPABILITIES"));
  assert.ok(Object.keys(prefixes).length >= 3, `parsed only ${Object.keys(prefixes).length} prefixes`);
  for (const provider of Object.keys(prefixes)) {
    assert.ok(declared.has(provider), `prefix row "${provider}" is not a provider capabilities.py declares`);
  }
  // A provider with a built-in DEFAULT_MODEL is one an operator can pin WITHOUT
  // typing a slug; with no prefix, matrixSlug() hands the scorecard a bare model name
  // the OpenRouter-run matrix never measured, so the Models tab silently shows no
  // recommendation for exactly the providers that are easiest to select.
  const defaults = stringMap(CAPABILITIES, "DEFAULT_MODELS: dict");
  assert.ok(Object.keys(defaults).length >= 3, `parsed only ${Object.keys(defaults).length} default models`);
  for (const provider of Object.keys(defaults)) {
    assert.ok(prefixes[provider], `${provider} has a default model but no matrix slug prefix`);
  }
  // The two tables must name the same vendor namespace (gemini -> google,
  // azure_openai -> openai): disagreeing means one model is metered under one bucket
  // and measured under another, and the Models tab's recommendation stops being about
  // the model the operator is actually paying for.
  const aliases = stringMap(LIGHTTRACK_TS, "const PROVIDER_ALIASES", "};");
  for (const [provider, prefix] of Object.entries(prefixes)) {
    if (aliases[provider]) assert.equal(prefix, aliases[provider], `${provider}: prefix and LightTrack alias disagree`);
  }
});
