// Locks the pre-flight capability decision for the voice call (idea-b0fc8018):
// candidates open interview links inside in-app webviews (Gmail, LinkedIn,
// Teams), over plain HTTP, or in browsers without WebRTC — the most common
// real-world failures of a first-round screen. The decision must name the root
// cause with an actionable instruction instead of the generic "Failed to start
// the call" the raw getUserMedia TypeError used to produce.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { voicePreflightError, type VoicePreflightEnv } from "./preflight.ts";

const capable: VoicePreflightEnv = {
  isSecureContext: true,
  hasMediaDevices: true,
  hasGetUserMedia: true,
  hasRTCPeerConnection: true,
};

test("a fully capable browser passes pre-flight for both providers", () => {
  assert.equal(voicePreflightError(capable, "openai"), null);
  assert.equal(voicePreflightError(capable, "elevenlabs"), null);
});

test("an insecure context is diagnosed first — it HIDES mediaDevices, so it must not read as a webview problem", () => {
  // Over plain HTTP the browser removes navigator.mediaDevices entirely; the
  // message must point at HTTPS, not at switching browsers.
  const httpLink: VoicePreflightEnv = {
    isSecureContext: false,
    hasMediaDevices: false,
    hasGetUserMedia: false,
    hasRTCPeerConnection: true,
  };
  const err = voicePreflightError(httpLink, "openai");
  assert.ok(err && /HTTPS/.test(err), `expected the HTTPS instruction, got: ${err}`);
});

test("a secure context without media capture reads as an in-app webview with a switch-browser instruction", () => {
  const webview: VoicePreflightEnv = { ...capable, hasMediaDevices: false, hasGetUserMedia: false };
  const err = voicePreflightError(webview, "elevenlabs");
  assert.ok(err && /full browser/i.test(err), `expected the switch-browser instruction, got: ${err}`);
  // mediaDevices existing without a callable getUserMedia is the same dead end.
  const partial: VoicePreflightEnv = { ...capable, hasGetUserMedia: false };
  assert.ok(voicePreflightError(partial, "elevenlabs"));
});

test("missing WebRTC only blocks the OpenAI path — ElevenLabs runs over WebSocket", () => {
  const noRtc: VoicePreflightEnv = { ...capable, hasRTCPeerConnection: false };
  const err = voicePreflightError(noRtc, "openai");
  assert.ok(err && /WebRTC/.test(err), `expected the WebRTC instruction, got: ${err}`);
  assert.equal(voicePreflightError(noRtc, "elevenlabs"), null);
});
