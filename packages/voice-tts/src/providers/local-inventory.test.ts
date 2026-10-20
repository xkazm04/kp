import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PiperTts } from "./piper.ts";
import { KokoroTts } from "./kokoro.ts";
import { FakeTts } from "./fake.ts";
import { createTts } from "../registry.ts";
import { pickVoice } from "../voice-pick.ts";
import type { TtsHost, TtsLogEvent } from "../types.ts";

function makeHost(env: Record<string, string> = {}): TtsHost {
  const logs: TtsLogEvent[] = [];
  return {
    env: (k) => env[k],
    homeDir: () => "/home/test",
    cwd: () => "/app",
    log: (e) => logs.push(e),
  };
}

test("Acceptance 1: Piper with only en voice installed probes ['en'] and resolves cs with unsupportedLanguage", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "piper-test-1-"));
  try {
    const dummyBin = path.join(dir, "piper");
    await writeFile(dummyBin, "binary");
    const onnx = path.join(dir, "en_US-lessac-medium.onnx");
    await writeFile(onnx, Buffer.alloc(1_000_001));
    await writeFile(
      `${onnx}.json`,
      JSON.stringify({ language: { code: "en_US" } }),
      "utf8"
    );

    const host = makeHost({
      PIPER_BIN: dummyBin,
      PIPER_VOICE_DIR: dir,
    });
    const piper = new PiperTts(host);
    const probe = await piper.probe();

    assert.equal(probe.state, "ready");
    if (probe.state === "ready") {
      assert.deepEqual(probe.languages, ["en"]);
    }

    const tts = createTts({ host, providers: [piper] });
    const resolved = await tts.resolve(undefined, "cs");
    assert.equal(resolved.provider.id, "piper");
    assert.equal(resolved.unsupportedLanguage, "cs");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Acceptance 2: Piper with en and de voices probes ['de','en'] and serves de over an English-only preferred Kokoro", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "piper-test-2-"));
  try {
    const dummyBin = path.join(dir, "piper");
    await writeFile(dummyBin, "binary");
    const enOnnx = path.join(dir, "en_US-lessac-medium.onnx");
    await writeFile(enOnnx, Buffer.alloc(1_000_001));
    await writeFile(
      `${enOnnx}.json`,
      JSON.stringify({ language: { code: "en_US" } }),
      "utf8"
    );
    const deOnnx = path.join(dir, "de_DE-thorsten-medium.onnx");
    await writeFile(deOnnx, Buffer.alloc(1_000_001));
    await writeFile(
      `${deOnnx}.json`,
      JSON.stringify({ language: { code: "de_DE" } }),
      "utf8"
    );

    const host = makeHost({
      PIPER_BIN: dummyBin,
      PIPER_VOICE_DIR: dir,
    });
    const piper = new PiperTts(host);
    const probe = await piper.probe();

    assert.equal(probe.state, "ready");
    if (probe.state === "ready") {
      assert.deepEqual(probe.languages, ["de", "en"]);
    }

    const kokoro = new FakeTts("kokoro", {
      capabilities: { languages: ["en"] },
      probe: { state: "ready", languages: ["en"] },
    });
    const tts = createTts({
      host,
      providers: [kokoro, piper],
      preference: { preferred: "kokoro", allowed: ["kokoro", "piper"] },
    });

    const resolved = await tts.resolve(undefined, "de");
    assert.equal(resolved.provider.id, "piper");
    assert.equal(resolved.fallbackFrom, "kokoro");
    assert.equal(resolved.unsupportedLanguage, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Acceptance 3: Kokoro with only built-in voices probes ['en'] and falls back to ElevenLabs for fr", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "kokoro-test-3-"));
  try {
    const dummyBin = path.join(dir, "sherpa-onnx-offline-tts");
    await writeFile(dummyBin, "bin");
    await writeFile(path.join(dir, "model.onnx"), "model");
    await writeFile(path.join(dir, "voices.bin"), "voices");
    await writeFile(path.join(dir, "tokens.txt"), "tokens");

    const host = makeHost({
      KOKORO_BIN: dummyBin,
      KOKORO_MODEL_DIR: dir,
    });
    const kokoro = new KokoroTts(host);
    const probe = await kokoro.probe();

    assert.equal(probe.state, "ready");
    if (probe.state === "ready") {
      assert.deepEqual(probe.languages, ["en"]);
    }

    const elevenlabs = new FakeTts("elevenlabs", {
      kind: "cloud",
      capabilities: { languages: "any" },
      probe: { state: "ready", languages: "any" },
    });

    const tts = createTts({
      host,
      providers: [kokoro, elevenlabs],
      preference: { preferred: "kokoro", allowed: ["kokoro", "elevenlabs"] },
    });

    const resolved = await tts.resolve("kokoro", "fr");
    assert.equal(resolved.provider.id, "elevenlabs");
    assert.equal(resolved.fallbackFrom, "kokoro");
    assert.equal(resolved.unsupportedLanguage, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Acceptance 4: KOKORO_VOICES parses 3-part form with language; pickVoice selects matching voice; 2-field form keeps language null", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "kokoro-test-4-"));
  try {
    const dummyBin = path.join(dir, "sherpa-onnx-offline-tts");
    await writeFile(dummyBin, "bin");
    await writeFile(path.join(dir, "model.onnx"), "model");
    await writeFile(path.join(dir, "voices.bin"), "voices");
    await writeFile(path.join(dir, "tokens.txt"), "tokens");

    const host = makeHost({
      KOKORO_BIN: dummyBin,
      KOKORO_MODEL_DIR: dir,
      KOKORO_VOICES: "ff_siwis:30:fr,x:5",
    });
    const kokoro = new KokoroTts(host);
    const probe = await kokoro.probe();

    assert.equal(probe.state, "ready");
    if (probe.state === "ready") {
      assert.ok(probe.languages && probe.languages !== "any");
      assert.ok(probe.languages.includes("fr"));
      assert.ok(probe.languages.includes("en"));
      // 2-field form 'x:5' has language null and adds no language
      assert.equal(probe.languages.length, 2);
    }

    const catalog = await kokoro.voices();
    const picked = pickVoice(catalog, { voiceId: null, language: "fr" });
    assert.ok(picked);
    assert.equal(picked.matched, true);
    assert.equal(picked.voice.id, "ff_siwis");

    const xVoice = catalog.find((v) => v.id === "x");
    assert.ok(xVoice);
    assert.equal(xVoice.language, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Acceptance 5: pickVoice on missing language returns catalog[0] with matched: false; unknown voiceId yields invalid_voice in adapter", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "kokoro-test-5-"));
  try {
    const dummyBin = path.join(dir, "sherpa-onnx-offline-tts");
    await writeFile(dummyBin, "bin");
    await writeFile(path.join(dir, "model.onnx"), "model");
    await writeFile(path.join(dir, "voices.bin"), "voices");
    await writeFile(path.join(dir, "tokens.txt"), "tokens");

    const host = makeHost({
      KOKORO_BIN: dummyBin,
      KOKORO_MODEL_DIR: dir,
    });
    const kokoro = new KokoroTts(host);
    const catalog = await kokoro.voices();

    // pickVoice on cs with no cs voice
    const picked = pickVoice(catalog, { voiceId: null, language: "cs" });
    assert.ok(picked);
    assert.deepEqual(picked, { voice: catalog[0], matched: false });

    // Explicit unknown voiceId gives null from pickVoice
    const unknownPick = pickVoice(catalog, { voiceId: "unknown-voice", language: "en" });
    assert.equal(unknownPick, null);

    // And kokoro.synthesize throws invalid_voice
    await assert.rejects(
      kokoro.synthesize({ text: "Hello", voiceId: "unknown-voice" }),
      (err: Error & { code?: string }) => err.code === "invalid_voice"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Acceptance 7: status() rows carry probed languages for ready providers and null for absent/broken ones", async () => {
  const readyFake = new FakeTts("piper", {
    probe: { state: "ready", languages: ["en", "cs"] },
  });
  const brokenFake = new FakeTts("kokoro", {
    probe: { state: "broken", reason: "missing model" },
  });
  const tts = createTts({
    host: makeHost(),
    providers: [readyFake, brokenFake],
  });

  const statuses = await tts.status();
  const readyRow = statuses.find((s) => s.id === "piper");
  const brokenRow = statuses.find((s) => s.id === "kokoro");

  assert.ok(readyRow);
  assert.equal(readyRow.probe.state, "ready");
  assert.deepEqual(readyRow.languages, ["en", "cs"]);

  assert.ok(brokenRow);
  assert.equal(brokenRow.probe.state, "broken");
  assert.equal(brokenRow.languages, null);
});
