// bug-ui-scan-2026-07-09 (model-api-key-management #2 + #4): pure KeysPanel logic.
//   #2 — a stale (hidden but retained) Azure endpoint must NOT ride along on a
//        non-Azure key: buildKeyRequestBody only carries endpoint/apiVersion for azure_openai.
//   #4 — saving onto an existing (provider, scope) pair silently REPLACES a live
//        key: findExistingKey surfaces the row a save would overwrite.
// Runner: node --test with type stripping (no DOM, no JSX). `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKeyRequestBody, canSubmitKeyForm, findExistingKey, keyFormMetaFor } from "./modelsKeysPanelLogic.ts";

// A ProviderKeyMeta-shaped fixture (only the fields the helper reads matter here).
const keys = [
  { provider: "openai", scope: "byom", baseUrl: "https://gw.corp.example/v1", updatedAt: "2026-07-01T00:00:00Z" },
  {
    provider: "azure_openai",
    scope: "platform",
    endpoint: "https://r.openai.azure.com",
    apiVersion: "2024-06-01",
    updatedAt: "2026-07-02T00:00:00Z",
  },
];

test("#4 findExistingKey returns the row a save would overwrite (provider+scope match)", () => {
  assert.deepEqual(findExistingKey(keys, "openai", "byom"), keys[0]);
  assert.deepEqual(findExistingKey(keys, "azure_openai", "platform"), keys[1]);
});

test("#4 findExistingKey returns undefined for a genuinely new provider/scope pair", () => {
  assert.equal(findExistingKey(keys, "openai", "platform"), undefined, "same provider, different scope = new");
  assert.equal(findExistingKey(keys, "gemini", "byom"), undefined, "unseen provider = new");
  assert.equal(findExistingKey(undefined, "openai", "byom"), undefined, "no data loaded yet = no match");
});

test("#2 NON-VACUITY: a stale Azure endpoint is DROPPED when the provider is not Azure", () => {
  // The exact pre-fix bug: operator typed an Azure endpoint, then flipped the
  // Select to openai. The retained `endpoint`/`apiVersion` state must not be sent.
  const body = buildKeyRequestBody({
    provider: "openai",
    scope: "byom",
    apiKey: "  sk-live  ",
    endpoint: "https://leftover.openai.azure.com",
    apiVersion: "2024-06-01",
  });
  assert.deepEqual(body, { provider: "openai", scope: "byom", apiKey: "sk-live" });
  assert.equal("endpoint" in body, false, "no Azure endpoint may leak onto an OpenAI key");
  assert.equal("apiVersion" in body, false, "no Azure apiVersion may leak onto an OpenAI key");
});

test("#2 Azure keeps its endpoint/apiVersion (trimmed)", () => {
  const body = buildKeyRequestBody({
    provider: "azure_openai",
    scope: "platform",
    apiKey: "secret",
    endpoint: "  https://r.openai.azure.com  ",
    apiVersion: "  2024-06-01  ",
  });
  assert.deepEqual(body, {
    provider: "azure_openai",
    scope: "platform",
    apiKey: "secret",
    endpoint: "https://r.openai.azure.com",
    apiVersion: "2024-06-01",
  });
});

// keyFormMetaFor: a save REPLACES the row's metadata wholesale, so an empty box is
// a delete. The boxes must therefore show what is stored for the selected row.
test("NON-VACUITY: rotating a key round-trips the stored Server URL instead of wiping it", () => {
  // Operator selects the openai/byom row (pointed at an in-house gateway) to paste
  // a rotated key. Pre-fix the form showed a blank Server URL, and the PUT body
  // built from it dropped `baseUrl` — silently sending the next call, with the
  // gateway's key, to the vendor cloud.
  const meta = keyFormMetaFor(keys, "openai", "byom");
  assert.equal(meta.baseUrl, "https://gw.corp.example/v1", "the stored server URL must be offered back");

  const body = buildKeyRequestBody({
    provider: "openai",
    scope: "byom",
    apiKey: "sk-rotated",
    endpoint: meta.endpoint,
    apiVersion: meta.apiVersion,
    baseUrl: meta.baseUrl,
  });
  assert.deepEqual(body, {
    provider: "openai",
    scope: "byom",
    apiKey: "sk-rotated",
    baseUrl: "https://gw.corp.example/v1",
  });
});

test("keyFormMetaFor offers Azure's endpoint/apiVersion back, and only to Azure", () => {
  assert.deepEqual(keyFormMetaFor(keys, "azure_openai", "platform"), {
    endpoint: "https://r.openai.azure.com",
    apiVersion: "2024-06-01",
    baseUrl: "",
  });
  // A different scope on the same provider is a NEW row — nothing to seed.
  assert.deepEqual(keyFormMetaFor(keys, "azure_openai", "byom"), { endpoint: "", apiVersion: "", baseUrl: "" });
  // Same drop-for-the-wrong-provider rule as buildKeyRequestBody: a provider whose
  // adapter ignores a field is never seeded with one, and gemini takes no base URL.
  assert.deepEqual(keyFormMetaFor(keys, "gemini", "byom"), { endpoint: "", apiVersion: "", baseUrl: "" });
  assert.deepEqual(keyFormMetaFor(undefined, "openai", "byom"), { endpoint: "", apiVersion: "", baseUrl: "" });
});

test("#2 Azure with empty endpoint/apiVersion omits them rather than sending blanks", () => {
  const body = buildKeyRequestBody({ provider: "azure_openai", scope: "byom", apiKey: "k", endpoint: "  ", apiVersion: "" });
  assert.deepEqual(body, { provider: "azure_openai", scope: "byom", apiKey: "k" });
});

// ---- canSubmitKeyForm: the button and the route must agree what a valid row is ----
// This guard had no test, and it is the ONE place the client re-states a server rule.
// If it drifts loose the operator meets a 400 they were invited to trigger; if it
// drifts tight the local-model path (a stock Ollama server authenticates nothing, so
// a base URL alone IS the row) becomes unreachable from the UI with no error to
// explain why.

const KEYLESS = ["ollama"] as const;

test("no provider selected is never submittable", () => {
  assert.equal(canSubmitKeyForm({ provider: "", apiKey: "sk-live", keylessProviders: KEYLESS }), false);
});

test("a keyed provider needs a key — a base URL alone does not stand in for one", () => {
  assert.equal(canSubmitKeyForm({ provider: "openai", apiKey: "sk-live", keylessProviders: KEYLESS }), true);
  assert.equal(canSubmitKeyForm({ provider: "openai", apiKey: "", keylessProviders: KEYLESS }), false);
  assert.equal(
    canSubmitKeyForm({ provider: "openai", apiKey: "   ", baseUrl: "https://gw.corp.example/v1", keylessProviders: KEYLESS }),
    false,
    "whitespace is not a key, and openai is not keyless"
  );
});

test("a KEYLESS provider is satisfied by a base URL alone", () => {
  assert.equal(canSubmitKeyForm({ provider: "ollama", apiKey: "", baseUrl: "http://localhost:11434/v1", keylessProviders: KEYLESS }), true);
  assert.equal(canSubmitKeyForm({ provider: "ollama", apiKey: "", keylessProviders: KEYLESS }), false, "neither field = a row that says nothing");
  assert.equal(canSubmitKeyForm({ provider: "ollama", apiKey: "", baseUrl: "  ", keylessProviders: KEYLESS }), false);
  assert.equal(canSubmitKeyForm({ provider: "ollama", apiKey: "sk-anything", keylessProviders: KEYLESS }), true, "a key still works");
});
