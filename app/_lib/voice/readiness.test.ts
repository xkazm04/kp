// challenge-r09 voice-provider-io/B: the realtime voice plane gets evidence-based
// readiness (absent / unchecked / ready / broken), the price in force with where it
// came from, the preference it is actually honouring, and probe memory that never
// mints on a read.
//
// Env is process.env (the voice lib reads it at call time); every case sets and
// restores exactly the vars it names. Adapters and the clock are injected, so no case
// reaches a provider.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  VOICE_PROBE_TTL_MS,
  buildVoiceReadiness,
  createProbeMemory,
  probeVoiceProviders,
  voiceBilling,
  voicePreference,
  type ReadinessAdapters,
  type VoiceReadinessRow,
} from "./readiness.ts";
import { VoiceMintError } from "./mint-error.ts";
import { voiceMinutePriceUsd } from "./minute-prices.ts";
import { pickDefaultProvider } from "./index.ts";
import type { VoiceConnect, VoiceProviderId } from "./types.ts";

const VARS = [
  "OPENAI_API_KEY",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_AGENT_ID",
  "ELEVENLABS_BASE_URL",
  "KP_VOICE_MINUTE_USD_OPENAI",
  "KP_VOICE_MINUTE_USD_ELEVENLABS",
  "KP_VOICE_PROVIDER",
];
const saved: Record<string, string | undefined> = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
function env(values: Record<string, string | undefined>) {
  for (const k of VARS) delete process.env[k];
  for (const [k, v] of Object.entries(values)) if (v !== undefined) process.env[k] = v;
}
afterEach(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const OPENAI_ENV = ["OPENAI_API_KEY"];
const ELEVEN_ENV = ["ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID"];

/** Adapters whose connect() is scripted per provider and counted. */
function doubles(script: Partial<Record<VoiceProviderId, () => Promise<VoiceConnect>>> = {}) {
  const calls: VoiceProviderId[] = [];
  const make = (id: VoiceProviderId, requiredEnv: string[]) => ({
    id,
    requiredEnv,
    available: () => requiredEnv.every((n) => !!process.env[n]),
    connect: async () => {
      calls.push(id);
      const run = script[id];
      if (!run) throw new Error(`unscripted connect for ${id}`);
      return run();
    },
  });
  const adapters = { openai: make("openai", OPENAI_ENV), elevenlabs: make("elevenlabs", ELEVEN_ENV) } as ReadinessAdapters;
  return { adapters, calls };
}

const row = (rows: VoiceReadinessRow[], id: VoiceProviderId) => {
  const r = rows.find((x) => x.provider === id);
  assert.ok(r, `a row for ${id}`);
  return r;
};

test("case 1 — no probe, no green: an absent provider names its need, a configured one is unchecked", () => {
  env({ ELEVENLABS_API_KEY: "xi", ELEVENLABS_AGENT_ID: "agent-x" });
  const { adapters, calls } = doubles();
  const report = buildVoiceReadiness({ adapters, memory: createProbeMemory(), failovers: [] });
  const openai = row(report.providers, "openai");
  assert.equal(openai.state, "absent");
  assert.deepEqual(openai.need, ["OPENAI_API_KEY"]);
  const eleven = row(report.providers, "elevenlabs");
  assert.equal(eleven.state, "unchecked");
  assert.deepEqual(eleven.need, []);
  assert.ok(!report.providers.some((r) => r.state === "ready"), "nothing is ready before a mint succeeded");
  assert.deepEqual(calls, [], "building the report never mints");
});

test("case 2 — the price in force, with where it came from", () => {
  env({ ELEVENLABS_BASE_URL: "http://127.0.0.1:8080" });
  assert.deepEqual(voiceBilling("elevenlabs"), { kind: "self-hosted", usdPerMin: 0 });

  env({ KP_VOICE_MINUTE_USD_OPENAI: "0.2" });
  assert.deepEqual(voiceBilling("openai"), { kind: "per-minute", usdPerMin: 0.2, source: "override" });

  env({});
  assert.deepEqual(voiceBilling("openai"), { kind: "per-minute", usdPerMin: 0.15, source: "estimate" });

  env({ KP_VOICE_MINUTE_USD_OPENAI: "$0.12" });
  assert.deepEqual(voiceBilling("openai"), {
    kind: "per-minute",
    usdPerMin: 0.15,
    source: "estimate",
    malformedOverride: "KP_VOICE_MINUTE_USD_OPENAI",
  });
});

test("case 2 drift guard — the strip's number IS the ledger's number for every override shape", () => {
  const original = console.warn;
  console.warn = () => {};
  try {
    for (const raw of [undefined, "", "0", "0.2", " 0.07 ", "$0.12", "-1", "abc"]) {
      for (const id of ["openai", "elevenlabs"] as const) {
        env({ KP_VOICE_MINUTE_USD_OPENAI: raw, KP_VOICE_MINUTE_USD_ELEVENLABS: raw });
        const billing = voiceBilling(id);
        assert.equal(billing.usdPerMin, voiceMinutePriceUsd(id), `${id} with ${JSON.stringify(raw)}`);
      }
    }
  } finally {
    console.warn = original;
  }
});

test("case 4 — a live probe: one ready with latency, one broken with cause and remedy, under allSettled", async () => {
  env({ OPENAI_API_KEY: "sk", ELEVENLABS_API_KEY: "xi", ELEVENLABS_AGENT_ID: "agent-x" });
  let clock = 1_000_000;
  let releaseEleven: () => void = () => {};
  const { adapters, calls } = doubles({
    openai: async () => {
      clock += 40;
      return { provider: "openai", model: "m", clientSecret: "SECRET", callsUrl: "u" };
    },
    // Rejects only after openai has settled: allSettled must wait for both, and one
    // provider's failure must not hide the other's verdict.
    elevenlabs: () =>
      new Promise((_, reject) => {
        releaseEleven = () => reject(new VoiceMintError({ provider: "elevenlabs", cause: "not_found", status: 404, message: "404" }));
      }),
  });
  const memory = createProbeMemory();
  const pending = probeVoiceProviders({ adapters, memory, failovers: [], now: () => clock });
  await new Promise((r) => setTimeout(r, 5));
  releaseEleven();
  const report = await pending;
  const openai = row(report.providers, "openai");
  assert.equal(openai.state, "ready");
  assert.equal(openai.latencyMs, 40);
  const eleven = row(report.providers, "elevenlabs");
  assert.equal(eleven.state, "broken");
  assert.equal(eleven.cause, "not_found");
  assert.deepEqual(eleven.remedy, { kind: "env", vars: ["ELEVENLABS_AGENT_ID", "ELEVENLABS_BASE_URL"] });
  assert.deepEqual([...calls].sort(), ["elevenlabs", "openai"]);
});

test("case 4 — an absent provider is never dialed, and an untyped throw is 'upstream', not a crash", async () => {
  env({ ELEVENLABS_API_KEY: "xi", ELEVENLABS_AGENT_ID: "agent-x" });
  const { adapters, calls } = doubles({
    elevenlabs: async () => {
      throw new Error("something odd");
    },
  });
  const report = await probeVoiceProviders({ adapters, memory: createProbeMemory(), failovers: [] });
  assert.deepEqual(calls, ["elevenlabs"]);
  assert.equal(row(report.providers, "openai").state, "absent");
  const eleven = row(report.providers, "elevenlabs");
  assert.equal(eleven.state, "broken");
  assert.equal(eleven.cause, "upstream");
  assert.deepEqual(eleven.remedy, { kind: "retry" });
});

test("case 5 — a silent reroute is made visible", () => {
  env({ KP_VOICE_PROVIDER: "elevenlabs", OPENAI_API_KEY: "sk" });
  const avail = { openai: true, elevenlabs: false };
  const pref = voicePreference(avail);
  assert.deepEqual(pref, { requested: "elevenlabs", honored: false, defaultProvider: "openai" });
  // The strip names the SAME provider the house policy routes new links to.
  assert.equal(pref?.defaultProvider, pickDefaultProvider(null, avail));

  env({ KP_VOICE_PROVIDER: "ElevenLabs", ELEVENLABS_API_KEY: "xi", ELEVENLABS_AGENT_ID: "a" });
  const both = { openai: false, elevenlabs: true };
  assert.deepEqual(voicePreference(both), { requested: "elevenlabs", honored: true, defaultProvider: "elevenlabs" });
  assert.equal(voicePreference(both)?.defaultProvider, pickDefaultProvider(null, both));

  env({});
  assert.equal(voicePreference({ openai: true, elevenlabs: false }), null, "no preference set, nothing to report");
});

test("case 6 — probe memory: a GET inside the TTL reads the POST's verdict; after it, unchecked; a GET never mints", async () => {
  env({ OPENAI_API_KEY: "sk" });
  let clock = 5_000_000;
  const { adapters, calls } = doubles({
    openai: async () => ({ provider: "openai", model: "m", clientSecret: "s", callsUrl: "u" }),
  });
  const memory = createProbeMemory();
  await probeVoiceProviders({ adapters, memory, failovers: [], now: () => clock });
  assert.equal(calls.length, 1);

  clock += VOICE_PROBE_TTL_MS - 1;
  const inside = row(buildVoiceReadiness({ adapters, memory, failovers: [], now: () => clock }).providers, "openai");
  assert.equal(inside.state, "ready");
  assert.equal(inside.checkedAt, new Date(5_000_000).toISOString());

  clock += 2;
  const after = row(buildVoiceReadiness({ adapters, memory, failovers: [], now: () => clock }).providers, "openai");
  assert.equal(after.state, "unchecked");
  assert.equal(after.checkedAt, null);
  assert.equal(calls.length, 1, "reads never call adapter.connect");
});

test("case 6 — a rotated key invalidates the remembered verdict at once", async () => {
  env({ OPENAI_API_KEY: "sk-old" });
  const { adapters } = doubles({
    openai: async () => ({ provider: "openai", model: "m", clientSecret: "s", callsUrl: "u" }),
  });
  const memory = createProbeMemory();
  await probeVoiceProviders({ adapters, memory, failovers: [], now: () => 1 });
  env({ OPENAI_API_KEY: "sk-new" });
  assert.equal(row(buildVoiceReadiness({ adapters, memory, failovers: [], now: () => 2 }).providers, "openai").state, "unchecked");
});

test("failover history lands on the row it fell back FROM", () => {
  env({ OPENAI_API_KEY: "sk", ELEVENLABS_API_KEY: "xi", ELEVENLABS_AGENT_ID: "a" });
  const { adapters } = doubles();
  const report = buildVoiceReadiness({
    adapters,
    memory: createProbeMemory(),
    failovers: [{ from: "elevenlabs", to: "openai", count: 2 }],
  });
  assert.deepEqual(row(report.providers, "elevenlabs").failovers, [{ to: "openai", count: 2 }]);
  assert.deepEqual(row(report.providers, "openai").failovers, []);
});
