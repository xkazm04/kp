// The live-call transport contract (challenge-r08 voice-interview-components/A).
//
// VoiceInterview.tsx used to branch on the provider's NAME in seven places — directive
// injection, the closing-answer grace, mic mute, output mute, unmount teardown, the end
// handshake and the speaking flag — and one parity gap had already slipped through that
// way: the presence orb's level box was written only by the OpenAI meters, so on an
// ElevenLabs call the orb sat flat for the whole interview. The shell now holds ONE
// CallTransport and asks what it can do, never which one it is.
//
// No browser, no SDK and no key reach this file: the ElevenLabs adapter takes the SDK
// session STRUCTURALLY (transport/elevenlabs.ts imports @elevenlabs/react and is not
// node-importable), and the OpenAI adapter runs over fake ref boxes.
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  elevenLabsCallTransport,
  openAiCallTransport,
  planEnd,
  sessionFromRef,
  type CallTransport,
  type ElevenLabsSessionLike,
} from "./call-transport.ts";
import type { OaiRefs, VoiceLevels } from "./openai.ts";

// ── fakes ───────────────────────────────────────────────────────────────────────

type FakeConv = ElevenLabsSessionLike & {
  calls: { setMuted: boolean[]; setVolume: number[]; contextual: string[]; endSession: number };
};

function fakeConv(over: Partial<ElevenLabsSessionLike> = {}): FakeConv {
  const calls = { setMuted: [] as boolean[], setVolume: [] as number[], contextual: [] as string[], endSession: 0 };
  return {
    calls,
    setMuted: (m: boolean) => void calls.setMuted.push(m),
    setVolume: ({ volume }: { volume: number }) => void calls.setVolume.push(volume),
    sendContextualUpdate: (text: string) => void calls.contextual.push(text),
    endSession: () => void (calls.endSession += 1),
    getInputVolume: () => 0,
    getOutputVolume: () => 0,
    ...over,
  };
}

type FakeTrack = { enabled: boolean; stopped: number; stop: () => void };
function fakeTrack(): FakeTrack {
  const t: FakeTrack = { enabled: true, stopped: 0, stop: () => void (t.stopped += 1) };
  return t;
}

function fakeOaiRefs(opts: { mic?: boolean; audio?: boolean } = {}) {
  const tracks = [fakeTrack(), fakeTrack()];
  const counts = { dcClose: 0, pcClose: 0, sent: [] as string[] };
  const mic =
    opts.mic === false
      ? null
      : ({ getAudioTracks: () => tracks, getTracks: () => tracks } as unknown as MediaStream);
  const audio = opts.audio === false ? null : ({ muted: false, srcObject: null } as unknown as HTMLAudioElement);
  const dc = {
    readyState: "open",
    send: (s: string) => void counts.sent.push(s),
    close: () => void (counts.dcClose += 1),
  } as unknown as RTCDataChannel;
  const pc = { getSenders: () => [], close: () => void (counts.pcClose += 1) } as unknown as RTCPeerConnection;
  const refs: OaiRefs = {
    pc: { current: pc },
    mic: { current: mic },
    dc: { current: dc },
    audio: { current: audio },
    audioCtx: { current: null },
    raf: { current: null },
    dropTimer: { current: null },
    asstBuf: { current: "" },
    candBuf: { current: "" },
    pendingCandidate: { current: false },
  };
  return { refs, tracks, counts };
}

// A third transport that names no provider — the proof that the contract is the
// seam, not a description of two particular engines.
function fakeTransport() {
  const counts = { end: 0 };
  let ended = false;
  const handle = {};
  const t: CallTransport = {
    handle,
    capabilities: { finalizeOn: "immediate", pendingTurnGraceMs: 0, levels: "sampled" },
    setMicMuted: () => !ended,
    setOutputMuted: () => !ended,
    stopCapture: () => {},
    injectDirective: (text) => !ended && text.trim().length > 0,
    sampleLevels: (box) => {
      box.current = { input: 0.1, output: 0.2 };
    },
    end: () => {
      if (ended) return;
      ended = true;
      counts.end += 1;
    },
  };
  return { t, closes: () => counts.end };
}

// ── case 1: ElevenLabs mic mute ─────────────────────────────────────────────────

test("ElevenLabs mic mute goes through the SDK once and reports success", () => {
  const conv = fakeConv();
  const transport = elevenLabsCallTransport(conv);
  assert.equal(transport.setMicMuted(true), true);
  assert.deepEqual(conv.calls.setMuted, [true]);
});

test("an ElevenLabs SDK that is not ready reports false instead of throwing", () => {
  const conv = fakeConv({
    setMuted: () => {
      throw new Error("no conversation");
    },
  });
  const transport = elevenLabsCallTransport(conv);
  assert.doesNotThrow(() => transport.setMicMuted(true));
  assert.equal(transport.setMicMuted(true), false);
});

// ── case 2: ElevenLabs output mute ──────────────────────────────────────────────

test("ElevenLabs output mute is the SDK volume, 0 and back to 1", () => {
  const conv = fakeConv();
  const transport = elevenLabsCallTransport(conv);
  assert.equal(transport.setOutputMuted(true), true);
  assert.equal(transport.setOutputMuted(false), true);
  assert.deepEqual(conv.calls.setVolume, [0, 1]);
});

// ── case 3: ElevenLabs presence levels (the dead orb) ───────────────────────────

test("ElevenLabs feeds the presence box from the SDK's own volumes, clamped", () => {
  const conv = fakeConv({ getInputVolume: () => 0.4, getOutputVolume: () => 1.7 });
  const box: { current: VoiceLevels } = { current: { input: 0, output: 0 } };
  elevenLabsCallTransport(conv).sampleLevels(box);
  assert.deepEqual(box.current, { input: 0.4, output: 1 });
});

test("a NaN or throwing volume getter writes 0, never NaN", () => {
  const box: { current: VoiceLevels } = { current: { input: 0.5, output: 0.5 } };
  elevenLabsCallTransport(fakeConv({ getInputVolume: () => Number.NaN, getOutputVolume: () => 0.3 })).sampleLevels(box);
  assert.deepEqual(box.current, { input: 0, output: 0.3 });
  elevenLabsCallTransport(
    fakeConv({
      getInputVolume: () => 0.2,
      getOutputVolume: () => {
        throw new Error("gone");
      },
    }),
  ).sampleLevels(box);
  assert.deepEqual(box.current, { input: 0.2, output: 0 });
  assert.equal(elevenLabsCallTransport(fakeConv()).capabilities.levels, "sampled");
});

// ── case 4: OpenAI mic / output mute ────────────────────────────────────────────

test("OpenAI mic mute disables every audio track of the call's stream", () => {
  const { refs, tracks } = fakeOaiRefs();
  const transport = openAiCallTransport(refs);
  assert.equal(transport.setMicMuted(true), true);
  assert.deepEqual(
    tracks.map((t) => t.enabled),
    [false, false],
  );
  transport.setMicMuted(false);
  assert.deepEqual(
    tracks.map((t) => t.enabled),
    [true, true],
  );
});

test("OpenAI output mute is the hidden <audio> element", () => {
  const { refs } = fakeOaiRefs();
  assert.equal(openAiCallTransport(refs).setOutputMuted(true), true);
  assert.equal(refs.audio.current?.muted, true);
});

test("OpenAI mute with no stream or no element reports false and does not throw", () => {
  const { refs } = fakeOaiRefs({ mic: false, audio: false });
  const transport = openAiCallTransport(refs);
  assert.equal(transport.setMicMuted(true), false);
  assert.equal(transport.setOutputMuted(true), false);
  assert.equal(transport.capabilities.levels, "pushed", "the OpenAI meters write the box themselves");
});

// ── case 5: declared end capability, not identity ──────────────────────────────

test("each transport declares how its call ends", () => {
  assert.deepEqual(elevenLabsCallTransport(fakeConv()).capabilities, {
    finalizeOn: "disconnect",
    closeGraceMs: 3000,
    levels: "sampled",
  });
  assert.deepEqual(openAiCallTransport(fakeOaiRefs().refs).capabilities, {
    finalizeOn: "immediate",
    pendingTurnGraceMs: 3000,
    levels: "pushed",
  });
});

test("planEnd decides the end handshake from the capability alone", () => {
  const oai = openAiCallTransport(fakeOaiRefs().refs).capabilities;
  const el = elevenLabsCallTransport(fakeConv()).capabilities;
  const pending = { pendingCandidate: true, channelOpen: true };
  assert.deepEqual(planEnd(oai, pending), { stopCaptureThenWaitMs: 3000 });
  assert.deepEqual(planEnd(el, pending), { endSessionThenWaitMs: 3000 });
  // Nothing in flight, or nowhere for it to arrive: finalize now.
  assert.deepEqual(planEnd(oai, { pendingCandidate: false, channelOpen: true }), {});
  assert.deepEqual(planEnd(oai, { pendingCandidate: true, channelOpen: false }), {});
  // A disconnect-finalizing transport waits for its close whatever the turn state.
  assert.deepEqual(planEnd(el, { pendingCandidate: false, channelOpen: false }), { endSessionThenWaitMs: 3000 });
  // No transport yet (End before /connect answered): nothing to wait for.
  assert.deepEqual(planEnd(null, pending), {});
});

// ── case 6: one contract suite, three transports ────────────────────────────────

function contractSuite(name: string, make: () => { t: CallTransport; closes: () => number }) {
  test(`${name}: mute is idempotent`, () => {
    const { t } = make();
    const a = t.setMicMuted(true);
    assert.equal(t.setMicMuted(true), a);
    const b = t.setOutputMuted(true);
    assert.equal(t.setOutputMuted(true), b);
  });
  test(`${name}: end() twice closes once`, () => {
    const { t, closes } = make();
    t.end();
    t.end();
    assert.equal(closes(), 1);
  });
  test(`${name}: sampleLevels never throws and leaves finite levels`, () => {
    const { t } = make();
    const box: { current: VoiceLevels } = { current: { input: 0, output: 0 } };
    assert.doesNotThrow(() => t.sampleLevels(box));
    assert.ok(Number.isFinite(box.current.input) && Number.isFinite(box.current.output));
  });
  test(`${name}: injectDirective answers a boolean`, () => {
    const { t } = make();
    assert.equal(typeof t.injectDirective("[Director] move on"), "boolean");
    assert.equal(t.injectDirective("   "), false, "an empty direction is never sent");
  });
  test(`${name}: stopCapture never throws`, () => {
    const { t } = make();
    assert.doesNotThrow(() => t.stopCapture());
  });
}

contractSuite("ElevenLabs adapter", () => {
  const conv = fakeConv();
  return { t: elevenLabsCallTransport(conv), closes: () => conv.calls.endSession };
});
contractSuite("OpenAI adapter", () => {
  const { refs, counts } = fakeOaiRefs();
  return { t: openAiCallTransport(refs), closes: () => counts.dcClose };
});
contractSuite("provider-free fake", fakeTransport);

test("OpenAI end() closes the peer connection once as well", () => {
  const { refs, counts } = fakeOaiRefs();
  const t = openAiCallTransport(refs);
  t.end();
  t.end();
  assert.equal(counts.pcClose, 1);
});

test("directives reach each engine on its own channel", () => {
  const conv = fakeConv();
  assert.equal(elevenLabsCallTransport(conv).injectDirective("[Director] next"), true);
  assert.deepEqual(conv.calls.contextual, ["[Director] next"]);
  const { refs, counts } = fakeOaiRefs();
  assert.equal(openAiCallTransport(refs).injectDirective("[Director] next"), true);
  assert.equal(counts.sent.length, 1);
});

test("a session read through a ref fails closed while the SDK object is absent", () => {
  const box: { current: ElevenLabsSessionLike | null } = { current: null };
  const session = sessionFromRef(box);
  const t = elevenLabsCallTransport(session);
  assert.equal(t.setMicMuted(true), false, "no SDK object yet — nothing was muted");
  const conv = fakeConv();
  box.current = conv;
  assert.equal(t.setMicMuted(true), true);
  assert.deepEqual(conv.calls.setMuted, [true]);
  assert.equal(t.handle, session, "the handle is the stable session, not a per-render SDK object");
});

// ── case 7: engine names leave the surface ──────────────────────────────────────
// DECISION (critic revision): the start() dispatch — `c.provider === "openai"` — is the
// ONE permitted provider-keyed line. Opening a session takes provider-specific inputs
// (an SDP exchange with a client secret vs an SDK signed URL + overrides), so it stays
// the entry point that CHOOSES the transport; everything after it asks the transport.

test("VoiceInterview.tsx names an engine exactly once — the dispatch that picks the transport", () => {
  const src = readFileSync(new URL("../VoiceInterview.tsx", import.meta.url), "utf8");
  const hits = src.match(/[!=]==\s*"(?:elevenlabs|openai)"/g) ?? [];
  assert.equal(hits.length, 1, `provider-name comparisons found: ${hits.join(", ")}`);
  assert.match(src, /if \(c\.provider === "openai"\) \{/, "the permitted one is the start() dispatch");
  assert.doesNotMatch(src, /providerRef/, "no shell-side provider latch survives the transport");
});
