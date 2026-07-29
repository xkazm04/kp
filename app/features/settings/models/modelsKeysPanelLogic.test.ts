// bug-ui-scan-2026-07-09 (model-api-key-management #2 + #4): pure KeysPanel logic.
//   #2 — a stale (hidden but retained) Azure endpoint must NOT ride along on a
//        non-Azure key: buildKeyRequestBody only carries endpoint/apiVersion for azure_openai.
//   #4 — saving onto an existing (provider, scope) pair silently REPLACES a live
//        key: findExistingKey surfaces the row a save would overwrite.
// Runner: node --test with type stripping (no DOM, no JSX). `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKeyRequestBody, findExistingKey } from "./modelsKeysPanelLogic.ts";

// A ProviderKeyMeta-shaped fixture (only the fields the helper reads matter here).
const keys = [
  { provider: "openai", scope: "byom", updatedAt: "2026-07-01T00:00:00Z" },
  { provider: "azure_openai", scope: "platform", endpoint: "https://r.openai.azure.com", updatedAt: "2026-07-02T00:00:00Z" },
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

test("#2 Azure with empty endpoint/apiVersion omits them rather than sending blanks", () => {
  const body = buildKeyRequestBody({ provider: "azure_openai", scope: "byom", apiKey: "k", endpoint: "  ", apiVersion: "" });
  assert.deepEqual(body, { provider: "azure_openai", scope: "byom", apiKey: "k" });
});
