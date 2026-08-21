// Pointing the voice path at a service we run ourselves.
//
// One env var decides three things — which host mints the signed URL, whether a
// session is billable, and whether the connect throttle is sized for paid
// credits — so these tests pin the derivation itself. The conservative half is
// the important half: an override this app cannot verify is free must keep
// being treated as paid.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { elevenLabsBaseUrl, isSelfHostedProvider, isSelfHostedVoice } from "./self-hosted.ts";
import { voiceMinuteCostUsd } from "./minute-prices.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved = new Map(Object.keys(vars).map((n) => [n, process.env[n]]));
  for (const [n, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[n];
    else process.env[n] = v;
  }
  try {
    fn();
  } finally {
    for (const [n, v] of saved) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
}

test("an install that sets nothing still calls the hosted service", () => {
  withEnv({ ELEVENLABS_BASE_URL: undefined }, () => {
    assert.equal(elevenLabsBaseUrl(), "https://api.elevenlabs.io");
    assert.equal(isSelfHostedVoice(), false);
  });
});

test("the base URL is normalized, not concatenated blindly", () => {
  withEnv({ ELEVENLABS_BASE_URL: "http://127.0.0.1:8080///" }, () => {
    assert.equal(elevenLabsBaseUrl(), "http://127.0.0.1:8080");
  });
  withEnv({ ELEVENLABS_BASE_URL: "   " }, () => {
    assert.equal(elevenLabsBaseUrl(), "https://api.elevenlabs.io");
  });
});

test("loopback and private hosts count as self-hosted", () => {
  for (const url of [
    "http://127.0.0.1:8080",
    "http://localhost:8080",
    "http://[::1]:8080",
    "http://10.0.0.5:8080",
    "http://192.168.1.20:8080",
    "http://172.16.4.4:8080",
    "http://172.31.255.1:8080",
    "http://voice.local:8080",
    "https://gravitone.internal",
  ]) {
    withEnv({ ELEVENLABS_BASE_URL: url }, () => {
      assert.equal(isSelfHostedVoice(), true, url);
    });
  }
});

test("a public override is still treated as paid", () => {
  // The asymmetry is deliberate: wrongly believing a session is free disables a
  // billing gate, wrongly believing it is paid only debits a meter.
  for (const url of [
    "https://api.elevenlabs.io",
    "https://voice.example.com",
    "https://172.32.0.1", // just outside the RFC1918 block
    "https://11.0.0.1",
    "not a url",
  ]) {
    withEnv({ ELEVENLABS_BASE_URL: url }, () => {
      assert.equal(isSelfHostedVoice(), false, url);
    });
  }
});

test("a NAME that merely starts with a private range is still paid", () => {
  // The numeric ranges describe IP ADDRESSES. Read off a hostname they also
  // matched a public per-minute vendor whose first label happens to be "10" /
  // "192.168" / "172.16" / "169.254" / "100.64", and the install would then skip
  // /simulate's interview_minutes gate and mint 120 credentials per 10 min.
  for (const url of [
    "https://10.voice-vendor.example.com",
    "https://192.168.example.com",
    "https://172.16.example.net",
    "https://169.254.example.org",
    "https://100.64.example.com",
  ]) {
    withEnv({ ELEVENLABS_BASE_URL: url }, () => {
      assert.equal(isSelfHostedVoice(), false, url);
    });
  }
  // …while the addresses themselves keep counting.
  withEnv({ ELEVENLABS_BASE_URL: "http://10.0.0.5:8080" }, () => {
    assert.equal(isSelfHostedVoice(), true);
  });
});

test("the ENV question and the SESSION question are not the same question", () => {
  // The distinction this file exists to keep: isSelfHostedVoice() answers "is a
  // local endpoint configured on this install", isSelfHostedProvider() answers
  // "is THIS call free". Conflating them is how a paid OpenAI Realtime session on
  // a self-hosted-ElevenLabs box got a 20x credential-mint budget it never earned.
  withEnv({ ELEVENLABS_BASE_URL: "http://127.0.0.1:8080" }, () => {
    assert.equal(isSelfHostedVoice(), true); // the endpoint IS configured…
    assert.equal(isSelfHostedProvider("openai"), false); // …and this call still costs money.
    assert.ok(voiceMinuteCostUsd("openai", 10) > 0);
  });
});

test("only the ElevenLabs adapter has a self-hosted path", () => {
  withEnv({ ELEVENLABS_BASE_URL: "http://127.0.0.1:8080" }, () => {
    assert.equal(isSelfHostedProvider("elevenlabs"), true);
    // OpenAI Realtime has no local implementation in this app; a local
    // ElevenLabs base URL says nothing about it.
    assert.equal(isSelfHostedProvider("openai"), false);
  });
});

test("a self-hosted session costs nothing per minute", () => {
  withEnv({ ELEVENLABS_BASE_URL: "http://127.0.0.1:8080" }, () => {
    assert.equal(voiceMinuteCostUsd("elevenlabs", 30), 0);
    // The other provider is unaffected — it is still the hosted one.
    assert.ok(voiceMinuteCostUsd("openai", 30) > 0);
  });
});

test("hosted pricing is untouched when nothing is overridden", () => {
  withEnv({ ELEVENLABS_BASE_URL: undefined }, () => {
    assert.equal(voiceMinuteCostUsd("elevenlabs", 10), 0.9);
  });
});
