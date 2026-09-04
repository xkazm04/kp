// Lockstep: BASE_URL_PROVIDERS (TS) must match the Python routing rule it mirrors.
//
// WHY THIS FILE. `providerAcceptsBaseUrl` decides whether the Models keys panel
// offers a base-URL field and whether PUT /api/llm/keys will persist one; Python's
// `registry.resolve_provider` / `probe_provider` decide whether a saved base URL is
// ever threaded into the adapter. Those are two halves of one rule, and until this
// test existed the Python half was written out TWICE as an inline
// `("openai", "ollama", "qwen")` literal with nothing pinning either copy to the TS
// list — the one mirror in this layer without a lockstep guard, while
// llm-capabilities-lockstep.test.ts and llm-model-required.test.ts guard the rest.
//
// It rots in a direction nothing else can see:
//
//   • a provider TS offers but Python's tuple omits => the operator saves a base URL,
//     the panel shows it saved, and the adapter silently keeps calling the vendor
//     cloud. On a self-host that is the whole point of the setting, and under
//     KP_OFFLINE it is the difference between "sealed" and "sealed for the wrong
//     reason" (the offline check runs on the resolved base URL).
//   • a provider Python threads but TS does not offer => the field never appears, so
//     the endpoint can only be set through an env var the UI never mentions.
//
// Reading the Python source keeps both honest without running Python — the same
// shape (and the same anti-vacuity floor) as llm-capabilities-lockstep.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_URL_PROVIDERS, providerAcceptsBaseUrl } from "./llm-model-defaults.ts";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTRY = path.join(REPO_ROOT, "pipeline", "jobfit", "llm", "registry.py");

// Matched literally up to the opening paren, so a renamed or re-shaped declaration
// fails the shape guard rather than matching one of the prose mentions above it.
const PY_DECLARATION = 'BASE_URL_PROVIDERS: tuple[str, ...] = ';

/** The string members of a top-level Python tuple literal, in declaration order. */
function pythonTupleMembers(file: string, declaration: string): string[] {
  const source = readFileSync(file, "utf-8");
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} not found in ${path.basename(file)} — did the declaration change shape?`);
  const open = source.indexOf("(", start);
  const close = source.indexOf(")", open);
  assert.ok(open !== -1 && close > open, `${declaration} is not a parenthesised tuple any more`);
  return [...source.slice(open, close).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

test("the Python declaration still has the shape this test reads", () => {
  // Anti-vacuity: every assertion below compares against this parse, so a parse
  // that silently produced nothing would make them all pass while proving nothing.
  const declared = pythonTupleMembers(REGISTRY, PY_DECLARATION);
  assert.ok(declared.length >= 3, `parsed only ${declared.length} providers from BASE_URL_PROVIDERS`);
  assert.ok(declared.includes("ollama"), "ollama — the local-model path — must accept a base URL");
});

test("BASE_URL_PROVIDERS matches the Python routing tuple exactly", () => {
  assert.deepEqual(
    [...BASE_URL_PROVIDERS].sort(),
    pythonTupleMembers(REGISTRY, PY_DECLARATION).sort(),
    "a base URL the panel accepts but the registry never threads is a setting that silently does nothing"
  );
});

test("Python threads the base URL from the single tuple, not an inline literal", () => {
  // The failure this guards is subtler than a mismatch: the rule used to be spelled
  // out inline in BOTH resolve_provider and probe_provider, so "fixing" one copy
  // left the Test button and the production route disagreeing about the same key.
  const source = readFileSync(REGISTRY, "utf-8");
  const inlineCopies = [...source.matchAll(/in \("openai", "ollama", "qwen"\)/g)];
  assert.equal(
    inlineCopies.length,
    0,
    "registry.py re-spells the base-URL provider list inline; branch on BASE_URL_PROVIDERS instead"
  );
  assert.ok(
    source.split("in BASE_URL_PROVIDERS").length - 1 >= 2,
    "both resolve_provider and probe_provider should branch on BASE_URL_PROVIDERS"
  );
});

test("providerAcceptsBaseUrl answers for the exact declared set", () => {
  for (const provider of BASE_URL_PROVIDERS) assert.ok(providerAcceptsBaseUrl(provider), provider);
  assert.equal(providerAcceptsBaseUrl("anthropic"), false);
  // Azure routes through its resource endpoint, never the generic base URL — the
  // adapter overrides _resolved_base_url() to None precisely so it cannot pick one up.
  assert.equal(providerAcceptsBaseUrl("azure_openai"), false);
});
