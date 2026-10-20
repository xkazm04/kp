// Provider traits (challenge-r09 voice-provider-io/A). The server side of the
// voice plane used to name its providers outside the adapters — a two-member
// failover complement, a free-to-paid rule spelled `openai: false` in one route,
// prompt plane and ASR bias decided by `=== "elevenlabs"`, the relay provider
// hardcoded as getVoiceAdapter("openai"). These cases pin that the seams now ask
// what a provider CAN do (VOICE_PROVIDER_TRAITS), never which one it is.
//
//   node scripts/run-unit-tests.mjs app/_lib/voice/provider-traits.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VOICE_PROVIDER_TRAITS,
  failoverOrder,
  providerTraits,
  relayFallbackProvider,
  relayProvider,
} from "./provider-traits.ts";
import { VOICE_PROVIDER_ORDER, coerceProviderId } from "./types.ts";
import { voiceAvailability } from "./index.ts";
import { voicePreflightCode } from "./preflight.ts";
import { isSelfHostedProvider } from "./self-hosted.ts";
import { voiceSessionModel } from "./minute-prices.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, rel), "utf8");

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("the trait table is total and truthful, and browser-safe", () => {
  for (const id of VOICE_PROVIDER_ORDER) assert.ok(VOICE_PROVIDER_TRAITS[id], `no traits for ${id}`);
  assert.deepEqual(VOICE_PROVIDER_TRAITS.openai, {
    transport: "webrtc",
    prompt: "server",
    asrKeywords: false,
    relay: true,
    selfHostable: false,
    modelIdentity: "realtime-model",
  });
  assert.deepEqual(VOICE_PROVIDER_TRAITS.elevenlabs, {
    transport: "websocket",
    prompt: "client-override",
    asrKeywords: true,
    relay: false,
    selfHostable: true,
    modelIdentity: "agent-id",
  });
  assert.equal(providerTraits("elevenlabs"), VOICE_PROVIDER_TRAITS.elevenlabs);
  // preflight.ts is browser code and reads this table: the module may import only
  // the pure vocabulary in ./types.ts, never an adapter, the DB or node built-ins.
  const imports = [...read("./provider-traits.ts").matchAll(/^import[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(imports)], ["./types.ts"]);
});

test("failoverOrder: the alternates, never the preferred, only the available", () => {
  assert.deepEqual(failoverOrder("openai", { openai: true, elevenlabs: true }, () => false), ["elevenlabs"]);
  assert.deepEqual(failoverOrder("openai", { openai: true, elevenlabs: false }, () => false), []);
  assert.deepEqual(failoverOrder("elevenlabs", { openai: true, elevenlabs: true }, () => false), ["openai"]);
  // A free preferred provider is never rescued onto a paid one.
  assert.deepEqual(failoverOrder("elevenlabs", { openai: true, elevenlabs: true }, (id) => id === "elevenlabs"), []);
});

test("derived vocabulary: the id guard and the availability map read VOICE_PROVIDER_ORDER", () => {
  assert.equal(coerceProviderId("elevenlabs"), "elevenlabs");
  assert.equal(coerceProviderId("ELEVENLABS"), null);
  assert.equal(coerceProviderId("x", "openai"), "openai");
  const keys = ["OPENAI_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID"];
  const want = [...VOICE_PROVIDER_ORDER].sort();
  withEnv(Object.fromEntries(keys.map((k) => [k, "set"])), () => {
    assert.deepEqual(Object.keys(voiceAvailability()).sort(), want);
  });
  withEnv(Object.fromEntries(keys.map((k) => [k, undefined])), () => {
    assert.deepEqual(Object.keys(voiceAvailability()).sort(), want);
  });
});

test("behaviour is unchanged for today's two providers", () => {
  const noRtc = { isSecureContext: true, hasMediaDevices: true, hasGetUserMedia: true, hasRTCPeerConnection: false };
  assert.equal(voicePreflightCode(noRtc, "elevenlabs"), null);
  assert.equal(voicePreflightCode(noRtc, "openai"), "VOICE_PREFLIGHT_NO_WEBRTC");
  const local = { ELEVENLABS_BASE_URL: "http://127.0.0.1:8080" } as unknown as NodeJS.ProcessEnv;
  assert.equal(isSelfHostedProvider("elevenlabs", local), true);
  assert.equal(isSelfHostedProvider("openai", local), false);
  assert.equal(isSelfHostedProvider("not-a-provider", local), false);
  withEnv({ ELEVENLABS_AGENT_ID: "agent_123" }, () => {
    assert.equal(voiceSessionModel("elevenlabs"), "agent_123");
  });
});

test("relay is a trait, not a hardcoded name", () => {
  assert.equal(relayProvider({ openai: true, elevenlabs: true }), "openai");
  assert.equal(relayProvider({ openai: false, elevenlabs: true }), null);
  // The 503 names the first relay-capable provider and ITS need, so the intake
  // wire stays { provider: "openai", need: ["OPENAI_API_KEY"] } byte for byte.
  assert.equal(relayFallbackProvider(), "openai");
  const route = read("../../api/intake/[id]/voice-connect/route.ts");
  assert.match(route, /relayProvider\(voiceAvailability\(\)\) \?\? relayFallbackProvider\(\)/);
  assert.match(
    route,
    /jsonRefusal\("INTAKE_VOICE_NOT_CONFIGURED", 503, \{ provider: relayId, need: missingVoiceEnv\(adapter\) \}\)/
  );
  // The rate-limit contract's pins still match.
  assert.ok(route.includes("adapter.connect("));
  assert.ok(route.includes("const voiceConnectLimit = 6;"));
});

test("names leave the seams: no provider-name branch outside the adapters", () => {
  const files = [
    "../../api/interview/connect/route.ts",
    "../../api/intake/[id]/voice-connect/route.ts",
    "./connect-failover.ts",
    "./self-hosted.ts",
    "./minute-prices.ts",
    "./preflight.ts",
    "./types.ts",
  ];
  const hits: string[] = [];
  for (const rel of files) {
    read(rel)
      .split("\n")
      .forEach((line, i) => {
        if (/[!=]== "(openai|elevenlabs)"/.test(line) || line.includes("openai: false") || line.includes('getVoiceAdapter("openai")')) {
          hits.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
  }
  assert.deepEqual(hits, []);
});
