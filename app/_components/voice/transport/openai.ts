// OpenAI Realtime transport for the voice interview — raw WebRTC, no SDK.
// Extracted verbatim from VoiceInterview.tsx: this module owns the connection
// objects (peer connection, mic stream, data channel, remote <audio>), the
// H3 speaking-meter analyser, the H4 drop debounce, and the transcript-buffer
// half of the wire protocol. Everything it needs from the component shell —
// phase/error state, the completed-vs-failed verdict, pushTurn — arrives as
// callbacks in the ctx objects below, so the ORDER of every statement here is
// the order the component used to run it in.
//
// Plain module (not a hook) on purpose: the transport is entirely ref- and
// callback-driven, so keeping it hook-free means it cannot perturb the
// component's hook order, and the moved code needed no restructuring at all.

import { parseOaiTranscriptEvent } from "@/app/_lib/voice/openai";
import type { VoiceTurn } from "@/app/_lib/voice/types";
import {
  VoiceTransportError,
  classifyCallsStatus,
  classifyThrownTransportFailure,
} from "./transport-error";

/** How long a "disconnected" ICE state is tolerated before it counts as a drop.
 *  Long enough to ride out a wifi handover, short enough that a candidate is not
 *  left talking into a dead pipe (the degraded cue shows IMMEDIATELY, see below). */
const OAI_DROP_DEBOUNCE_MS = 8000;

/** RMS above which the assistant counts as speaking, for the H3 indicator. Lower
 *  than the mic test's heard threshold on purpose: this is decoded provider audio,
 *  not a room microphone, so its noise floor is essentially zero. */
const OAI_SPEAKING_RMS = 0.02;

/** How long the browser waits for OpenAI to answer its SDP offer before giving
 *  up. The only bound on this exchange used to be the component's 30s connect
 *  latch, which tears the call down but leaves the fetch itself pending — so a
 *  provider that accepted the POST and never answered kept a mic-holding
 *  RTCPeerConnection and a live promise behind an error card the candidate was
 *  already reading. Aborting at 12s keeps the failure inside the latch, so it
 *  arrives as VOICE_TRANSPORT_TIMEOUT ("the provider did not answer in time" —
 *  classifyThrownTransportFailure maps AbortError) instead of a generic
 *  "couldn't start the call" that never says who was slow. */
const OAI_SDP_TIMEOUT_MS = 12_000;

/** Every mutable handle the OpenAI path owns. The component keeps them as ten
 *  ordinary useRefs (the React Compiler's immutability rule wants component-side
 *  writes to be plain ref writes) and bundles them into this shape on demand. */
export type OaiRefs = {
  pc: { current: RTCPeerConnection | null };
  mic: { current: MediaStream | null };
  dc: { current: RTCDataChannel | null };
  audio: { current: HTMLAudioElement | null };
  // H3: an AnalyserNode on the OpenAI remote (assistant) audio drives the speaking indicator —
  // the ElevenLabs SDK exposes isSpeaking but the raw-WebRTC OpenAI path has no equivalent, so
  // the pill was stuck on "Listening" for every OpenAI session. H4: a grace timer debounces a
  // transient ICE "disconnected" before we treat a mid-call network drop as terminal.
  audioCtx: { current: AudioContext | null };
  raf: { current: number | null };
  dropTimer: { current: ReturnType<typeof setTimeout> | null };
  asstBuf: { current: string };
  // The candidate side is asymmetric (idea-b70b8bd7): an utterance only becomes
  // a turn when its async transcription .completed event lands. candBuf collects
  // streamed transcription deltas (empty on whisper-1, which doesn't stream);
  // pendingCandidate tracks VAD speech_started → transcription completed, so
  // finalize knows a final answer is still in flight at hang-up.
  candBuf: { current: string };
  pendingCandidate: { current: boolean };
};

/** The transient UI cues the transport owns. Stable React setters, so the
 *  component can wrap teardown in a `useCallback` with no changing deps. */
export type OaiCues = {
  setSpeaking: (v: boolean) => void;
  setUnstable: (v: boolean) => void;
  setAudioBlocked: (v: boolean) => void;
};

export function teardownOpenAi(refs: OaiRefs, cues: OaiCues) {
  try {
    refs.dc.current?.close();
  } catch {
    /* noop */
  }
  try {
    refs.pc.current?.getSenders().forEach((s) => s.track?.stop());
    refs.pc.current?.close();
  } catch {
    /* noop */
  }
  refs.mic.current?.getTracks().forEach((tr) => tr.stop());
  // Tear down the H3 speaking-meter analyser and the H4 drop timer.
  if (refs.raf.current != null) cancelAnimationFrame(refs.raf.current);
  refs.raf.current = null;
  try {
    void refs.audioCtx.current?.close();
  } catch {
    /* noop */
  }
  refs.audioCtx.current = null;
  if (refs.dropTimer.current) clearTimeout(refs.dropTimer.current);
  refs.dropTimer.current = null;
  cues.setSpeaking(false);
  // bug-ui-scan-2026-07-09 (voice-interview #3, #4): the degraded-connection and
  // blocked-audio cues are meaningless once the connection is gone — clear them
  // so a closing/error card never shows a stale "reconnecting"/"tap to enable".
  cues.setUnstable(false);
  cues.setAudioBlocked(false);
  refs.pc.current = null;
  refs.dc.current = null;
  refs.mic.current = null;
  if (refs.audio.current) {
    refs.audio.current.srcObject = null;
    // bug-ui-scan-2026-07-09 (voice-interview #4): the <audio> element persists
    // across calls (single ref) — clear the output mute so a retry never inherits
    // a stale muted state while the button reads "unmuted".
    refs.audio.current.muted = false;
  }
}

/** RELAY mode (voice-conversation-plane.md): speak an utterance OUR engine
 *  produced. The session was minted with create_response:false, so the model
 *  never talks on its own — this is the only way audio leaves the agent. The
 *  response.create instruction pins verbatim delivery; the spoken text still
 *  flows back through the normal assistant transcript events, so the
 *  transcript accumulates identically to the provider-brain path. */
export function speakText(refs: OaiRefs, text: string): boolean {
  const dc = refs.dc.current;
  if (!dc || dc.readyState !== "open" || !text.trim()) return false;
  try {
    dc.send(
      JSON.stringify({
        type: "response.create",
        response: {
          instructions:
            "Say exactly the following, verbatim, in its own language, with natural spoken delivery. " +
            "Do not add, translate, or omit anything:\n" +
            text,
        },
      })
    );
    return true;
  } catch {
    return false;
  }
}

/** RELAY mode: stop the current spoken reply (barge-in — the requestor started
 *  talking over the agent). Best-effort; server VAD's interrupt_response
 *  already ducks audio, this also cancels the in-flight response. */
export function cancelSpeech(refs: OaiRefs): void {
  const dc = refs.dc.current;
  if (!dc || dc.readyState !== "open") return;
  try {
    dc.send(JSON.stringify({ type: "response.cancel" }));
  } catch {
    /* best-effort */
  }
}

export function applyOaiTranscriptEvent(
  ev: Record<string, unknown>,
  refs: OaiRefs,
  pushTurn: (role: VoiceTurn["role"], text: string) => void
) {
  // The realtime wire protocol (event-type strings + payload shape) is parsed
  // in voice/openai.ts; here we only apply the resulting transcript action.
  const parsed = parseOaiTranscriptEvent(ev);
  if (!parsed) return;
  if (parsed.kind === "candidateSpeechStarted") {
    refs.pendingCandidate.current = true;
  } else if (parsed.kind === "candidateDelta") {
    refs.candBuf.current += parsed.text;
  } else if (parsed.kind === "candidateUtterance") {
    refs.pendingCandidate.current = false;
    refs.candBuf.current = "";
    pushTurn("candidate", parsed.text);
  } else if (parsed.kind === "assistantDelta") {
    refs.asstBuf.current += parsed.text;
  } else if (parsed.kind === "assistantDone") {
    pushTurn("interviewer", refs.asstBuf.current);
    refs.asstBuf.current = "";
  }
}

// H3: drive the "AI speaking" indicator from the OpenAI remote audio level (the raw-WebRTC path
// has no isSpeaking like the ElevenLabs SDK). Best-effort — any failure just leaves the pill on
// its default, and the CSS animation is already reduced-motion gated.
export function startOaiSpeakingMeter(refs: OaiRefs, stream: MediaStream, setSpeaking: (v: boolean) => void) {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    refs.audioCtx.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      setSpeaking(Math.sqrt(sum / data.length) > OAI_SPEAKING_RMS);
      refs.raf.current = requestAnimationFrame(tick);
    };
    refs.raf.current = requestAnimationFrame(tick);
  } catch {
    /* analyser is enhancement only */
  }
}

/** What startOpenAiCall needs from the component shell. All of it is either a
 *  ref box or a callback, so this ctx can be rebuilt per call without any
 *  memoization concerns. */
export type OaiStartCtx = {
  refs: OaiRefs;
  finalizedRef: { current: boolean };
  reachedLiveRef: { current: boolean };
  pushTurn: (role: VoiceTurn["role"], text: string) => void;
  setSpeaking: (v: boolean) => void;
  setUnstable: (v: boolean) => void;
  setAudioBlocked: (v: boolean) => void;
  setAwaitingMic: (v: boolean) => void;
  setLive: () => void;
  clearConnectTimer: () => void;
  /** H4 terminal-drop handler — it needs the shared completed-vs-failed verdict
   *  and finalize(), both of which live in the component. */
  onDrop: () => void;
};

export async function startOpenAiCall(
  c: { model: string; clientSecret: string; callsUrl: string },
  ctx: OaiStartCtx
) {
  const { refs } = ctx;
  const pc = new RTCPeerConnection();
  refs.pc.current = pc;
  pc.ontrack = (e) => {
    const el = refs.audio.current;
    if (el) {
      el.srcObject = e.streams[0];
      // bug-ui-scan-2026-07-09 (voice-interview #4): the interviewer's voice is the
      // load-bearing channel. `autoPlay` fails SILENTLY on strict-mobile / low-power
      // browsers, leaving the candidate in silence with no cue — call play()
      // explicitly and, on rejection, raise a "tap to enable audio" recovery.
      void el
        .play()
        .then(() => ctx.setAudioBlocked(false))
        .catch(() => ctx.setAudioBlocked(true));
    }
    startOaiSpeakingMeter(refs, e.streams[0], ctx.setSpeaking);
  };
  // H4: react to a mid-call connection drop. "disconnected" can be a transient blip, so debounce
  // it; "failed" is terminal. A stale connection (torn down / replaced) is ignored.
  pc.onconnectionstatechange = () => {
    if (refs.pc.current !== pc) return;
    const st = pc.connectionState;
    if (st === "failed") {
      ctx.onDrop();
    } else if (st === "disconnected") {
      // bug-ui-scan-2026-07-09 (voice-interview #3): surface the degraded state
      // IMMEDIATELY (not after the 8s debounce), so the candidate knows to pause
      // instead of talking into a pipe that may already be gone.
      ctx.setUnstable(true);
      if (!refs.dropTimer.current) {
        refs.dropTimer.current = setTimeout(() => {
          refs.dropTimer.current = null;
          if (refs.pc.current === pc && (pc.connectionState === "disconnected" || pc.connectionState === "failed")) {
            ctx.onDrop();
          }
        }, OAI_DROP_DEBOUNCE_MS);
      }
    } else if (st === "connected") {
      // bug-ui-scan-2026-07-09 (voice-interview #3): recovered — drop the cue.
      ctx.setUnstable(false);
      if (refs.dropTimer.current) {
        clearTimeout(refs.dropTimer.current);
        refs.dropTimer.current = null;
      }
    }
  };
  ctx.setAwaitingMic(true);
  let mic: MediaStream;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  } finally {
    // Clear the hint whether the prompt was allowed, denied, or the call torn down —
    // it's only meaningful while the prompt is actually open.
    ctx.setAwaitingMic(false);
  }
  // The permission prompt can sit open for seconds; if the connect timeout or an
  // unmount tore down (or replaced) this connection meanwhile, stop the freshly
  // acquired tracks rather than leaving the microphone hot on a dead call.
  if (ctx.finalizedRef.current || refs.pc.current !== pc) {
    mic.getTracks().forEach((tr) => tr.stop());
    return;
  }
  refs.mic.current = mic;
  mic.getTracks().forEach((tr) => pc.addTrack(tr, mic));

  const dc = pc.createDataChannel("oai-events");
  refs.dc.current = dc;
  dc.onmessage = (e) => {
    try {
      applyOaiTranscriptEvent(JSON.parse(e.data as string), refs, ctx.pushTurn);
    } catch {
      /* non-JSON event */
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  // Every failure below leaves as a CODED VoiceTransportError. It used to be one
  // Error whose message was `OpenAI calls ${status}: ${body}` — the provider's own
  // response body — and the shell rendered that message straight into the
  // candidate's error banner: English in every locale, sometimes carrying key
  // fragments, always with no recovery step. The body now goes to the console for
  // the operator; the candidate gets `errors.<CODE>` in their language.
  let resp: Response;
  try {
    resp = await fetch(`${c.callsUrl}?model=${encodeURIComponent(c.model)}`, {
      method: "POST",
      body: offer.sdp,
      headers: { Authorization: `Bearer ${c.clientSecret}`, "Content-Type": "application/sdp" },
      // Bounded (see OAI_SDP_TIMEOUT_MS): an abort rejects the fetch and is
      // classified as VOICE_TRANSPORT_TIMEOUT by the catch below.
      signal: AbortSignal.timeout(OAI_SDP_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new VoiceTransportError(
      classifyThrownTransportFailure(cause),
      cause instanceof Error ? cause.message : String(cause ?? "")
    );
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    const err = new VoiceTransportError(classifyCallsStatus(resp.status), `${resp.status} ${detail.slice(0, 200)}`);
    // The operator's half of the failure: the real upstream body, once, in the
    // console — the only place it belongs.
    console.error(`[voice] OpenAI calls ${resp.status} (${err.code}): ${detail.slice(0, 200)}`);
    throw err;
  }
  await pc.setRemoteDescription({ type: "answer", sdp: await resp.text() });
  // Same guard as after getUserMedia: if the connect timeout fired (or this pc
  // was torn down / replaced) while dialing, don't present a live call that can
  // never be finalized — stop the connection we just built.
  if (ctx.finalizedRef.current || refs.pc.current !== pc) {
    try {
      pc.getSenders().forEach((s) => s.track?.stop());
      pc.close();
    } catch {
      /* noop */
    }
    return;
  }
  ctx.clearConnectTimer();
  // Mark the call as having gone live (parity with the ElevenLabs onConnect in
  // transport/elevenlabs.ts). The unmount transcript beacon and interviewFinalStatus both
  // gate on this ref; without it an in-progress OpenAI call lost its transcript on tab-close
  // and a hang-up couldn't be told from a never-live session. Safe here: we passed the
  // still-current-connection guard above, so a torn-down/replaced pc never marks live.
  ctx.reachedLiveRef.current = true;
  ctx.setLive();
}
