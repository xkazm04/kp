// The interface IS the test seam: everything below runs on FakeStt with no
// audio device, no network and no model file. Covered: the validation door, the
// preference parser's retired-id normalization, the resolution order, the
// CAPABILITY GATE (the one thing this package does that its synthesis sibling
// does not), visible fallback, the two shapes of "nothing can serve", the
// per-provider byte ceiling, and the WAV reader the local adapter refuses on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStt, preferenceFromEnv } from "./registry.ts";
import { FakeStt, silentWav } from "./providers/fake.ts";
import { SttError, type SttHost, type SttLogEvent } from "./types.ts";
import { STT_MAX_BYTES, validateRequest } from "./validate.ts";
import { wavInfo } from "./node/wav.ts";

function host(env: Record<string, string> = {}, log: SttLogEvent[] = []): SttHost {
  return { env: (k) => env[k], homeDir: () => "/home/x", cwd: () => "/app", log: (e) => log.push(e) };
}

const clip = { audio: silentWav(), mimeType: "audio/wav" as const };

test("validation door: empty, oversized, unknown container, bad language, bad model id", () => {
  assert.throws(() => validateRequest({ audio: new Uint8Array(0), mimeType: "audio/wav" }), (e: SttError) => e.code === "invalid_audio");
  assert.throws(
    () => validateRequest({ audio: new Uint8Array(STT_MAX_BYTES + 1), mimeType: "audio/wav" }),
    (e: SttError) => e.code === "invalid_audio",
  );
  assert.throws(
    () => validateRequest({ ...clip, mimeType: "audio/aiff" as never }),
    (e: SttError) => e.code === "invalid_audio",
  );
  assert.throws(() => validateRequest({ ...clip, language: "czech!" }), (e: SttError) => e.code === "invalid_language");
  assert.throws(() => validateRequest({ ...clip, modelId: "../etc/passwd" }), (e: SttError) => e.code === "invalid_model");

  const ok = validateRequest({ ...clip, language: "CS-CZ", diarize: true });
  assert.equal(ok.language, "cs-cz");
  assert.equal(ok.diarize, true);
  assert.equal(ok.redactPii, false);
  assert.equal(ok.modelId, null);
});

test("preferenceFromEnv drops unknown ids, keeps preferred inside allowed, defaults on-device first", () => {
  const p = preferenceFromEnv(host({ A: "AssemblyAI", B: "whisper_cpp, retired-engine" }), { preferred: "A", allowed: "B" });
  assert.deepEqual(p, { preferred: "assemblyai", allowed: ["assemblyai", "whisper_cpp"] });

  const none = preferenceFromEnv(host({}), { preferred: "A", allowed: "B" });
  assert.equal(none.preferred, null);
  // Order is policy: with nothing configured the on-device engine leads, so a
  // default install does not ship a candidate's voice to a vendor by accident.
  assert.deepEqual(none.allowed, ["whisper_cpp", "assemblyai"]);
});

test("resolve honors request > preferred > first ready, and fallback is visible", async () => {
  const log: SttLogEvent[] = [];
  const whisper = new FakeStt("whisper_cpp", { probe: { state: "absent", reason: "no model installed" } });
  const cloud = new FakeStt("assemblyai", { kind: "cloud" });
  const stt = createStt({
    host: host({}, log),
    providers: [whisper, cloud],
    preference: { preferred: "whisper_cpp", allowed: ["whisper_cpp", "assemblyai"] },
  });

  const r1 = await stt.resolve("assemblyai");
  assert.equal(r1.provider.id, "assemblyai");
  assert.equal(r1.fallbackFrom, null);

  const r2 = await stt.resolve();
  assert.equal(r2.provider.id, "assemblyai");
  assert.equal(r2.fallbackFrom, "whisper_cpp");
  assert.match(r2.reason!, /no model installed/);
  assert.ok(log.some((e) => e.type === "fallback" && e.from === "whisper_cpp" && e.to === "assemblyai"));

  const out = await stt.transcribe(clip);
  assert.equal(out.provider, "assemblyai");
  assert.equal(out.fallbackFrom, "whisper_cpp");
  assert.equal(cloud.calls.length, 1);
});

test("a request outside the allowed set is ignored, not served — the residency control", async () => {
  const whisper = new FakeStt("whisper_cpp");
  const cloud = new FakeStt("assemblyai", { kind: "cloud" });
  const stt = createStt({ host: host(), providers: [whisper, cloud], preference: { preferred: null, allowed: ["whisper_cpp"] } });
  const r = await stt.resolve("assemblyai");
  assert.equal(r.provider.id, "whisper_cpp");
  await stt.transcribe(clip, { provider: "assemblyai" });
  assert.equal(cloud.calls.length, 0, "a per-request provider cannot widen the allowed set");
});

test("redaction is never silently dropped: an engine that cannot redact is not in the order", async () => {
  const whisper = new FakeStt("whisper_cpp");
  const cloud = new FakeStt("assemblyai", { kind: "cloud", capabilities: { redaction: true, diarization: true } });
  const stt = createStt({ host: host(), providers: [whisper, cloud] });

  // Preferred (on-device) cannot redact, so the capable engine serves instead.
  const out = await stt.transcribe({ ...clip, redactPii: true });
  assert.equal(out.provider, "assemblyai");
  assert.equal(out.redacted, true);
  assert.equal(whisper.calls.length, 0);

  // …and when nothing capable is allowed, the answer is a typed refusal naming
  // the missing capability — never a 200 carrying the spans somebody asked to
  // have removed.
  const localOnly = createStt({ host: host(), providers: [whisper, cloud], preference: { preferred: null, allowed: ["whisper_cpp"] } });
  await assert.rejects(
    localOnly.transcribe({ ...clip, redactPii: true }),
    (e: SttError) => e.code === "unsupported" && /cannot redact/.test(e.message),
  );
});

test("needs.onDevice refuses to let audio leave the machine, even when the cloud is ready", async () => {
  const whisper = new FakeStt("whisper_cpp", { probe: { state: "absent", reason: "no model installed" } });
  const cloud = new FakeStt("assemblyai", { kind: "cloud" });
  const stt = createStt({ host: host(), providers: [whisper, cloud] });
  await assert.rejects(
    stt.transcribe(clip, { needs: { onDevice: true } }),
    (e: SttError) => e.code === "unavailable" && /no model installed/.test(e.message),
  );
  assert.equal(cloud.calls.length, 0);
});

test("a language the engine does not declare takes it out of the order", async () => {
  const english = new FakeStt("whisper_cpp", { capabilities: { languages: ["en"] } });
  const cloud = new FakeStt("assemblyai", { kind: "cloud" });
  const stt = createStt({ host: host(), providers: [english, cloud] });
  const out = await stt.transcribe({ ...clip, language: "cs" });
  assert.equal(out.provider, "assemblyai");
  assert.equal(english.calls.length, 0);
});

test("nothing ready -> unavailable with the last reason, never empty success", async () => {
  const whisper = new FakeStt("whisper_cpp", { probe: { state: "broken", reason: "model truncated" } });
  const stt = createStt({ host: host(), providers: [whisper] });
  await assert.rejects(stt.transcribe(clip), (e: SttError) => e.code === "unavailable" && /truncated/.test(e.message));
});

test("the serving engine's own byte ceiling is enforced after resolution", async () => {
  const small = new FakeStt("whisper_cpp", { capabilities: { maxBytes: 100 } });
  const stt = createStt({ host: host(), providers: [small] });
  await assert.rejects(
    stt.transcribe({ audio: silentWav(1000), mimeType: "audio/wav" }),
    (e: SttError) => e.code === "invalid_audio" && /at most 100 bytes/.test(e.message),
  );
});

test("status enumerates from the registry, flags allowed + preferred", async () => {
  const stt = createStt({
    host: host(),
    providers: [new FakeStt("whisper_cpp"), new FakeStt("assemblyai", { kind: "cloud" })],
    preference: { preferred: "assemblyai", allowed: ["assemblyai"] },
  });
  const s = await stt.status();
  assert.deepEqual(
    s.map((x) => [x.id, x.allowed, x.preferred, x.probe.state, x.capabilities.onDevice]),
    [
      ["whisper_cpp", false, false, "ready", true],
      ["assemblyai", true, true, "ready", false],
    ],
  );
});

test("wavInfo reads duration past injected chunks, and rejects non-WAV", () => {
  const info = wavInfo(silentWav(16_000));
  assert.equal(info?.sampleRate, 16_000);
  assert.equal(info?.channels, 1);
  assert.equal(info?.durationMs, 1000);
  assert.equal(wavInfo(new Uint8Array([1, 2, 3])), null);

  // A truncated file must report what is actually there, not what its header claims.
  const truncated = silentWav(16_000).subarray(0, 44 + 16_000);
  assert.equal(wavInfo(truncated)?.durationMs, 500);
});

test("a clip past the serving engine's maxClipSeconds is refused before it is sent", async () => {
  const short = new FakeStt("whisper_cpp", { capabilities: { maxClipSeconds: 1 } });
  const stt = createStt({ host: host(), providers: [short] });
  await assert.rejects(
    // 2 s of 16 kHz mono PCM — the ceiling is read from the WAV header, so the
    // refusal costs neither a subprocess nor an audio-hour.
    stt.transcribe({ audio: silentWav(32_000), mimeType: "audio/wav" }),
    (e: SttError) => e.code === "too_long" && /at most 1s/.test(e.message),
  );
  assert.equal(short.calls.length, 0);
  // …and a clip inside the ceiling still goes through.
  assert.equal((await stt.transcribe({ audio: silentWav(8_000), mimeType: "audio/wav" })).text, "hello");
});

test("resolve() takes the language, so the capability gate runs before any probe", async () => {
  const english = new FakeStt("whisper_cpp", { capabilities: { languages: ["en"] } });
  const cloud = new FakeStt("assemblyai", { kind: "cloud" });
  const stt = createStt({ host: host(), providers: [english, cloud] });
  const r = await stt.resolve(undefined, {}, "cs-CZ");
  assert.equal(r.provider.id, "assemblyai");
  assert.equal(english.probes, 0, "an engine that cannot serve the language is never probed");
  // Without the language the gate has nothing to filter on and the order stands.
  assert.equal((await stt.resolve()).provider.id, "whisper_cpp");
});
