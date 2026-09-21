// Locks the pre-flight capability decision for the voice call (idea-b0fc8018):
// candidates open interview links inside in-app webviews (Gmail, LinkedIn,
// Teams), over plain HTTP, or in browsers without WebRTC — the most common
// real-world failures of a first-round screen. The decision must name the root
// cause as a catalogued CODE (resolved through useErrorMessage) instead of a
// hardcoded English sentence the generic "Failed to start the call" used to
// hide behind.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  VOICE_PREFLIGHT_ERRORS,
  voicePreflightCode,
  type VoicePreflightCode,
  type VoicePreflightEnv,
} from "./preflight.ts";

const capable: VoicePreflightEnv = {
  isSecureContext: true,
  hasMediaDevices: true,
  hasGetUserMedia: true,
  hasRTCPeerConnection: true,
};

test("a fully capable browser passes pre-flight for both providers", () => {
  assert.equal(voicePreflightCode(capable, "openai"), null);
  assert.equal(voicePreflightCode(capable, "elevenlabs"), null);
});

test("an insecure context is diagnosed first — it HIDES mediaDevices, so it must not read as a webview problem", () => {
  // Over plain HTTP the browser removes navigator.mediaDevices entirely; the
  // code must be INSECURE (HTTPS instruction), not NO_MEDIA (switch browsers).
  const httpLink: VoicePreflightEnv = {
    isSecureContext: false,
    hasMediaDevices: false,
    hasGetUserMedia: false,
    hasRTCPeerConnection: true,
  };
  assert.equal(voicePreflightCode(httpLink, "openai"), "VOICE_PREFLIGHT_INSECURE");
});

test("a secure context without media capture reads as an in-app webview", () => {
  const webview: VoicePreflightEnv = { ...capable, hasMediaDevices: false, hasGetUserMedia: false };
  assert.equal(voicePreflightCode(webview, "elevenlabs"), "VOICE_PREFLIGHT_NO_MEDIA");
  // mediaDevices existing without a callable getUserMedia is the same dead end.
  const partial: VoicePreflightEnv = { ...capable, hasGetUserMedia: false };
  assert.equal(voicePreflightCode(partial, "elevenlabs"), "VOICE_PREFLIGHT_NO_MEDIA");
});

test("missing WebRTC only blocks the OpenAI path — ElevenLabs runs over WebSocket", () => {
  const noRtc: VoicePreflightEnv = { ...capable, hasRTCPeerConnection: false };
  assert.equal(voicePreflightCode(noRtc, "openai"), "VOICE_PREFLIGHT_NO_WEBRTC");
  assert.equal(voicePreflightCode(noRtc, "elevenlabs"), null);
});

test("every preflight code has copy in all four catalogs", () => {
  const codes = Object.keys(VOICE_PREFLIGHT_ERRORS) as VoicePreflightCode[];
  assert.equal(codes.length, 3, "three failures, three codes");
  for (const locale of ["en", "cs", "de", "fr"]) {
    const url = new URL(`../../../messages/${locale}.json`, import.meta.url);
    const catalog = JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as {
      errors?: Record<string, string>;
    };
    for (const code of codes) {
      const message = catalog.errors?.[code];
      assert.ok(
        typeof message === "string" && message.trim().length > 0,
        `messages/${locale}.json is missing errors.${code} — useErrorMessage would silently ` +
          `fall through to the generic sentence in that locale`,
      );
    }
  }
});
