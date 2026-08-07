import "./testing/unit-db.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { isRelayConfigured, resolveRelay } from "./comms-relay.ts";
import { getRelayConfig, setRelayConfig, getRelaySecret, CommsRelayError } from "./comms-relay-store.ts";

// The relay capability bit (env → stored config → nothing). This is the ONE
// source every "sent" claim and the comms channel selection key off, so its
// precedence contract is locked here (moved from comms-truth.test.ts when the
// env-only isRelayConfigured grew the stored-config leg).

test("unconfigured: no env, no stored config → not configured", () => {
  delete process.env.COMMS_WEBHOOK_URL;
  assert.equal(isRelayConfigured(), false);
  assert.equal(resolveRelay(), null);
});

test("COMMS_WEBHOOK_URL env keeps precedence over stored config", () => {
  try {
    setRelayConfig({ url: "https://relay.example/stored" });
    process.env.COMMS_WEBHOOK_URL = "https://relay.example/env";
    const relay = resolveRelay();
    assert.equal(relay?.url, "https://relay.example/env");
    assert.equal(relay?.source, "env");
  } finally {
    delete process.env.COMMS_WEBHOOK_URL;
    setRelayConfig({ url: "" });
  }
});

test("stored config configures the relay when env is unset", () => {
  delete process.env.COMMS_WEBHOOK_URL;
  try {
    setRelayConfig({ url: "https://relay.example/hook" });
    assert.equal(isRelayConfigured(), true);
    const relay = resolveRelay();
    assert.equal(relay?.url, "https://relay.example/hook");
    assert.equal(relay?.source, "config");
    // Clearing the URL disables it again.
    setRelayConfig({ url: "" });
    assert.equal(isRelayConfigured(), false);
  } finally {
    setRelayConfig({ url: "" });
  }
});

test("secret doctrine: public view exposes hasSecret only; omit keeps, empty clears", () => {
  // At-rest encryption needs a key (shared ats-secret helpers).
  process.env.KP_ATS_SECRET_KEY = "unit-test-relay-key";
  try {
    setRelayConfig({ url: "https://relay.example/hook", secret: "topsecret" });
    const pub = getRelayConfig();
    assert.equal(pub.hasSecret, true);
    assert.ok(!("secret" in pub), "public view must not carry the secret");
    assert.equal(getRelaySecret(), "topsecret");
    // Omitted secret → kept.
    setRelayConfig({ url: "https://relay.example/hook2" });
    assert.equal(getRelaySecret(), "topsecret");
    // Empty string → cleared.
    setRelayConfig({ url: "https://relay.example/hook2", secret: "" });
    assert.equal(getRelaySecret(), null);
    assert.equal(getRelayConfig().hasSecret, false);
  } finally {
    setRelayConfig({ url: "", secret: "" });
    delete process.env.KP_ATS_SECRET_KEY;
  }
});

test("write boundary rejects non-https and internal endpoints (SSRF guard)", () => {
  assert.throws(() => setRelayConfig({ url: "http://relay.example/hook" }), CommsRelayError);
  assert.throws(() => setRelayConfig({ url: "https://127.0.0.1/hook" }), CommsRelayError);
  assert.throws(() => setRelayConfig({ url: "not a url" }), CommsRelayError);
});
