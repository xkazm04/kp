import { test } from "node:test";
import assert from "node:assert/strict";
import { isOffline, egressAllowlist, egressAllowed, installOfflineFetchGuard, isPrivateHost } from "./offline.ts";

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
  for (const h of ["localhost", "127.0.0.1", "ollama", "extra.internal", "gateway.lan"]) {
    assert.ok(allow.has(h), `expected ${h} in allowlist`);
  }
  // A cloud host is NOT implicitly allowed.
  assert.equal(allow.has("api.openai.com"), false);
  // CHANGED DELIBERATELY. This line used to assert the opposite — that configuring
  // AZURE_OPENAI_ENDPOINT admitted `res.openai.azure.com`. That made the TS half
  // disagree with the Python half, which names `*.openai.azure.com` as a host it
  // seals off "even when explicitly configured" (llm/offline.py `is_local_url`),
  // on the reasoning that a configured endpoint "is NOT trusted just because it
  // was configured". Azure OpenAI is reached over the public internet, so
  // admitting it meant an air-gapped deployment still had a route out.
  assert.equal(
    allow.has("res.openai.azure.com"),
    false,
    "a public FQDN is not private merely because it was configured as an endpoint",
  );
});

test("a public endpoint can still be allowed, but only as a deliberate act", () => {
  // The escape hatch matters: an operator whose private service genuinely answers
  // to a public-looking name is not stuck, they just have to say so explicitly
  // rather than get it as a side effect of naming an inference endpoint.
  const allow = egressAllowlist(
    env({
      AZURE_OPENAI_ENDPOINT: "https://res.openai.azure.com",
      KP_OFFLINE_ALLOW_HOSTS: "res.openai.azure.com",
    })
  );
  assert.equal(allow.has("res.openai.azure.com"), true);
});

test("the app's own origin is reachable even under a public-looking name", () => {
  // Reaching yourself is not egress, and an air-gapped deployment may still be
  // published under an ordinary FQDN that only resolves inside its own network.
  // So the self-origin keys are exempt from the private-host test that governs
  // the outbound service endpoints.
  const allow = egressAllowlist(env({ APP_BASE_URL: "https://kp.example.com" }));
  assert.equal(allow.has("kp.example.com"), true);
});

test("isPrivateHost knows the shapes a self-host actually uses", () => {
  for (const host of [
    "localhost",
    "ollama", // bare container/service name
    "vllm.internal",
    "gateway.lan",
    "printer.local",
    "10.1.2.3",
    "192.168.0.10",
    "172.16.5.4",
    "127.0.0.1",
    "169.254.1.1",
    "fd00::1",
    "fe80::1",
  ]) {
    assert.equal(isPrivateHost(host), true, `${host} should read as private`);
  }
  for (const host of [
    "api.openai.com",
    "res.openai.azure.com",
    "generativelanguage.googleapis.com",
    "openrouter.ai",
    "8.8.8.8",
    "172.32.0.1", // just outside 172.16/12
    "2606:4700::1",
  ]) {
    assert.equal(isPrivateHost(host), false, `${host} should read as public`);
  }
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
