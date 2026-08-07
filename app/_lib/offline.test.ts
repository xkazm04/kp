import { test } from "node:test";
import assert from "node:assert/strict";
import { isOffline, egressAllowlist, egressAllowed, installOfflineFetchGuard } from "./offline.ts";

const env = (o: Record<string, string | undefined>) => o as NodeJS.ProcessEnv;

test("isOffline parses truthy/falsey KP_OFFLINE values", () => {
  for (const v of ["1", "true", "TRUE", "yes", "on", " On "]) assert.equal(isOffline(env({ KP_OFFLINE: v })), true);
  for (const v of ["", "0", "false", "no", "off"]) assert.equal(isOffline(env({ KP_OFFLINE: v })), false);
  assert.equal(isOffline(env({})), false);
});

test("egressAllowlist = loopback + configured private endpoints + explicit hosts", () => {
  const allow = egressAllowlist(
    env({
      OPENAI_BASE_URL: "http://ollama:11434/v1",
      AZURE_OPENAI_ENDPOINT: "https://res.openai.azure.com",
      KP_OFFLINE_ALLOW_HOSTS: "extra.internal, gateway.lan",
    })
  );
  for (const h of ["localhost", "127.0.0.1", "ollama", "res.openai.azure.com", "extra.internal", "gateway.lan"]) {
    assert.ok(allow.has(h), `expected ${h} in allowlist`);
  }
  // A cloud host is NOT implicitly allowed.
  assert.equal(allow.has("api.openai.com"), false);
});

test("egressAllowed: loopback + self-hosted allowed; cloud blocked; same-origin allowed", () => {
  const e = env({ OPENAI_BASE_URL: "http://ollama:11434/v1" });
  assert.equal(egressAllowed("http://localhost:3000/api/billing", e), true);
  assert.equal(egressAllowed("http://127.0.0.1:9/x", e), true);
  assert.equal(egressAllowed("http://ollama:11434/v1/chat/completions", e), true);
  assert.equal(egressAllowed("https://api.openai.com/v1/chat", e), false);
  assert.equal(egressAllowed("https://api.github.com/repos/x", e), false);
  assert.equal(egressAllowed("https://api.polar.sh/v1/checkouts", e), false);
  assert.equal(egressAllowed("/api/relative", e), true); // same-origin → loopback
});

test("installOfflineFetchGuard blocks cloud fetch and passes loopback/self-hosted through", async () => {
  const calls: string[] = [];
  const stub = ((input: unknown) => {
    calls.push(String(input));
    return Promise.resolve(new Response("ok"));
  }) as typeof fetch;
  const savedFetch = globalThis.fetch;
  const savedOffline = process.env.KP_OFFLINE;
  const savedBase = process.env.OPENAI_BASE_URL;
  try {
    globalThis.fetch = stub;
    process.env.KP_OFFLINE = "1";
    process.env.OPENAI_BASE_URL = "http://ollama:11434/v1";
    installOfflineFetchGuard();

    await globalThis.fetch("http://localhost:3000/api/billing"); // loopback → allowed
    await globalThis.fetch("http://ollama:11434/v1/chat/completions"); // self-hosted → allowed
    assert.deepEqual(calls, ["http://localhost:3000/api/billing", "http://ollama:11434/v1/chat/completions"]);

    await assert.rejects(
      () => globalThis.fetch("https://api.openai.com/v1/chat"),
      /KP_OFFLINE: blocked/,
      "cloud fetch must be rejected"
    );
    await assert.rejects(() => globalThis.fetch("https://api.github.com/repos/x"), /KP_OFFLINE: blocked/);
    assert.equal(calls.length, 2, "blocked calls must not reach the underlying fetch");
  } finally {
    globalThis.fetch = savedFetch;
    if (savedOffline === undefined) delete process.env.KP_OFFLINE;
    else process.env.KP_OFFLINE = savedOffline;
    if (savedBase === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = savedBase;
  }
});
