import type { VoiceProviderId } from "./types.ts";

// Pre-flight capability check for the voice call (idea-b0fc8018).
//
// start() used to assume a secure context with full media support and let
// navigator.mediaDevices.getUserMedia throw a TypeError that the generic catch
// surfaced as "Failed to start the call" — uselessly vague for the single most
// common real-world failure of a first-round voice screen: the candidate opens
// the emailed link inside an app's built-in webview (Gmail, LinkedIn, Teams),
// over plain HTTP, or in a browser without WebRTC. Checking capabilities BEFORE
// dialing turns that dead end into a specific, actionable instruction.
//
// Browser-safe pure helper (no server deps), mirroring finalize-status.ts: the
// DECISION is a pure function over a capability snapshot so it is unit-testable;
// the snapshot collector is the only part that touches browser globals.

/** What the call path needs from the environment, as one inspectable snapshot. */
export type VoicePreflightEnv = {
  /** window.isSecureContext — getUserMedia is only exposed on HTTPS/localhost. */
  isSecureContext: boolean;
  /** navigator.mediaDevices exists (undefined in insecure contexts and many in-app webviews). */
  hasMediaDevices: boolean;
  /** navigator.mediaDevices.getUserMedia is callable. */
  hasGetUserMedia: boolean;
  /** RTCPeerConnection exists — required by the OpenAI Realtime WebRTC path. */
  hasRTCPeerConnection: boolean;
};

/** Snapshot the live browser. Safe to call anywhere client-side; every probe is
 *  existence-checked so a bare environment yields `false`s, never a throw. */
export function collectVoicePreflightEnv(): VoicePreflightEnv {
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  return {
    isSecureContext: typeof window !== "undefined" && window.isSecureContext === true,
    hasMediaDevices: Boolean(md),
    hasGetUserMedia: typeof md?.getUserMedia === "function",
    hasRTCPeerConnection: typeof RTCPeerConnection !== "undefined",
  };
}

/** The actionable error for this environment, or null when the call can
 *  proceed. Ordered by root cause: an insecure context HIDES mediaDevices, so
 *  it must be diagnosed first or every HTTP link would read as a webview
 *  problem. ElevenLabs runs over WebSocket, so RTCPeerConnection is only
 *  required for the OpenAI path. */
export function voicePreflightError(env: VoicePreflightEnv, provider: VoiceProviderId): string | null {
  if (!env.isSecureContext) {
    return "This page isn't running in a secure context, so the browser blocks microphone access. Open the interview link over HTTPS (or on localhost).";
  }
  if (!env.hasMediaDevices || !env.hasGetUserMedia) {
    return "This browser can't capture microphone audio — this usually means the link opened inside an app's built-in preview (email, LinkedIn, Teams). Open the link in a full browser like Chrome, Edge or Safari.";
  }
  if (provider === "openai" && !env.hasRTCPeerConnection) {
    return "This browser doesn't support the real-time connection (WebRTC) this call needs. Open the link in an up-to-date browser like Chrome, Edge or Safari.";
  }
  return null;
}
