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
import { directiveMessage, parseOaiControlEvent, toolResultMessages } from "./oai-events";

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
  // ── the DIRECTED call's additions ────────────────────────────────────────────
  // OPTIONAL, all three: the role-intake relay surface
  // (features/library/jds/intake/JdsIntakeVoice.tsx) drives this same transport with
  // no presence orb and no director, and it must keep compiling — and behaving —
  // unchanged. Absent ⇒ the feature they carry simply does not run.
  //
  // The candidate-side meter: the presence orb follows the MICROPHONE while the
  // interviewer listens, and the raw-WebRTC path has no input level of its own (the
  // ElevenLabs SDK does). Its own context/RAF, because the remote analyser is built
  // in `ontrack`, which has no ordering relationship with the mic acquisition.
  inputCtx?: { current: AudioContext | null };
  inputRaf?: { current: number | null };
  /** Tool call ids already handed to the director — the same call arrives on two
   *  event spellings on some model lines, and answering it twice would push two
   *  `function_call_output` items for one `call_id`. */
  answeredCalls?: { current: Set<string> };
};

/** Live audio levels, 0..1, written by the meters and read by the presence orb on
 *  its OWN animation frame. A MUTABLE BOX on purpose: a React state update per
 *  frame would re-render the whole call shell 60 times a second to move one ring. */
export type VoiceLevels = { input: number; output: number };

/** The transient UI cues the transport owns. Stable React setters, so the
 *  component can wrap teardown in a `useCallback` with no changing deps. */
export type OaiCues = {
  setSpeaking: (v: boolean) => void;
  setUnstable: (v: boolean) => void;
  setAudioBlocked: (v: boolean) => void;
  /** The call's microphone stream, or null once it is gone. The recording hook
   *  (WP3) captures the SAME stream the call is using rather than opening a second
   *  one, which on some browsers changes the device's gain mid-interview. */
  setMicStream?: (stream: MediaStream | null) => void;
  /** Where the meters write. Absent in callers that render no presence orb. */
  levels?: { current: VoiceLevels };
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
  cues.setMicStream?.(null);
  // Tear down the H3 speaking-meter analyser and the H4 drop timer.
  if (refs.raf.current != null) cancelAnimationFrame(refs.raf.current);
  refs.raf.current = null;
  if (refs.inputRaf?.current != null) cancelAnimationFrame(refs.inputRaf.current);
  if (refs.inputRaf) refs.inputRaf.current = null;
  try {
    void refs.audioCtx.current?.close();
  } catch {
    /* noop */
  }
  refs.audioCtx.current = null;
  try {
    void refs.inputCtx?.current?.close();
  } catch {
    /* noop */
  }
  if (refs.inputCtx) refs.inputCtx.current = null;
  refs.answeredCalls?.current.clear();
  if (cues.levels) cues.levels.current = { input: 0, output: 0 };
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

/** What the DIRECTED call needs from the data channel, beyond the transcript. Every
 *  one is optional: the lab and any undirected session pass none of them and the
 *  protocol behaves exactly as it did before the director existed. */
export type OaiCallHooks = {
  /** The interviewer's line as it streams (`output_audio_transcript.delta`). The
   *  transcript still finalizes on `.done`; this is the provisional caption that
   *  keeps the candidate from staring at a silent log while the voice talks. */
  onInterviewerPartial?: (text: string) => void;
  /** Server VAD heard the candidate start / stop. */
  onCandidateSpeech?: (state: "started" | "stopped") => void;
  /** The interviewer's audio started / finished — the pre-answer silence is
   *  measured from the finish, and "thinking" ends at the start. */
  onInterviewerAudio?: (state: "started" | "done") => void;
  /** The model began generating: audio is seconds away. */
  onGenerating?: () => void;
  /** The model called a director tool and is blocked on its result. The handler
   *  owns the whole round trip (including answering it when the director is
   *  unreachable) and never throws. */
  onToolCall?: (call: { callId: string; name: string; args: unknown }) => void;
};

export function applyOaiTranscriptEvent(
  ev: Record<string, unknown>,
  refs: OaiRefs,
  pushTurn: (role: VoiceTurn["role"], text: string) => void,
  hooks: OaiCallHooks = {}
) {
  // The realtime wire protocol (event-type strings + payload shape) is parsed
  // in voice/openai.ts; here we only apply the resulting transcript action.
  const parsed = parseOaiTranscriptEvent(ev);
  if (parsed) {
    if (parsed.kind === "candidateSpeechStarted") {
      refs.pendingCandidate.current = true;
      hooks.onCandidateSpeech?.("started");
    } else if (parsed.kind === "candidateDelta") {
      refs.candBuf.current += parsed.text;
    } else if (parsed.kind === "candidateUtterance") {
      refs.pendingCandidate.current = false;
      refs.candBuf.current = "";
      pushTurn("candidate", parsed.text);
    } else if (parsed.kind === "assistantDelta") {
      refs.asstBuf.current += parsed.text;
      hooks.onInterviewerPartial?.(refs.asstBuf.current);
    } else if (parsed.kind === "assistantDone") {
      pushTurn("interviewer", refs.asstBuf.current);
      refs.asstBuf.current = "";
      hooks.onInterviewerPartial?.("");
    }
    return;
  }
  // The control half (oai-events.ts): tool calls, speech stop, audio boundaries.
  const control = parseOaiControlEvent(ev);
  if (!control) return;
  if (control.kind === "toolCall") {
    // Two event spellings can carry the SAME call on some model lines; answering
    // twice would push two outputs for one call_id and desynchronize the model.
    const seen = refs.answeredCalls?.current;
    if (seen) {
      if (seen.has(control.callId)) return;
      seen.add(control.callId);
    }
    hooks.onToolCall?.({ callId: control.callId, name: control.name, args: control.args });
  } else if (control.kind === "candidateSpeechStopped") {
    hooks.onCandidateSpeech?.("stopped");
  } else if (control.kind === "assistantAudioStarted") {
    hooks.onInterviewerAudio?.("started");
  } else if (control.kind === "assistantAudioDone") {
    hooks.onInterviewerAudio?.("done");
  } else if (control.kind === "responseStarted") {
    hooks.onGenerating?.();
  }
}

/** Hand the director's answer back to the waiting model, then let it speak again.
 *  Returns false when the channel is gone — the caller has nothing to retry with
 *  (the model is behind a closed socket), so this is a report, not an error. */
export function sendToolResult(refs: OaiRefs, callId: string, output: string): boolean {
  const dc = refs.dc.current;
  if (!dc || dc.readyState !== "open" || !callId) return false;
  try {
    for (const msg of toolResultMessages(callId, output)) dc.send(JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}

/** Inject ONE stage direction as a private system message. `text` arrives from the
 *  server already carrying the `[Director] ` prefix and is sent VERBATIM — the brief
 *  tells the model these are private and never read aloud. No `response.create`:
 *  see oai-events.ts::directiveMessage. */
export function sendDirective(refs: OaiRefs, text: string): boolean {
  const dc = refs.dc.current;
  if (!dc || dc.readyState !== "open" || !text.trim()) return false;
  try {
    dc.send(JSON.stringify(directiveMessage(text)));
    return true;
  } catch {
    return false;
  }
}

// H3: drive the "AI speaking" indicator from the OpenAI remote audio level (the raw-WebRTC path
// has no isSpeaking like the ElevenLabs SDK). Best-effort — any failure just leaves the pill on
// its default, and the CSS animation is already reduced-motion gated.
export function startOaiSpeakingMeter(
  refs: OaiRefs,
  stream: MediaStream,
  setSpeaking: (v: boolean) => void,
  levels?: { current: VoiceLevels }
) {
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
      const rms = Math.sqrt(sum / data.length);
      setSpeaking(rms > OAI_SPEAKING_RMS);
      // The level goes to the shared BOX, never to React: the orb reads it on its
      // own frame (see VoiceLevels).
      if (levels) levels.current = { ...levels.current, output: normalizeLevel(rms) };
      refs.raf.current = requestAnimationFrame(tick);
    };
    refs.raf.current = requestAnimationFrame(tick);
  } catch {
    /* analyser is enhancement only */
  }
}

/** Speech RMS sits well under 0.25, so the raw value would never move a ring.
 *  The same gain the mic test applies to its level bar (useMicTest MIC_LEVEL_GAIN). */
const LEVEL_GAIN = 4;
function normalizeLevel(rms: number): number {
  if (!Number.isFinite(rms)) return 0;
  return Math.min(1, Math.max(0, rms * LEVEL_GAIN));
}

/** The CANDIDATE-side meter: the presence orb follows the microphone while the
 *  interviewer listens. Best-effort, exactly like the remote meter — a browser
 *  without AudioContext simply gets a static ring. */
export function startOaiInputMeter(refs: OaiRefs, stream: MediaStream, levels: { current: VoiceLevels }) {
  const inputCtx = refs.inputCtx;
  const inputRaf = refs.inputRaf;
  if (!inputCtx || !inputRaf) return;
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    inputCtx.current = ctx;
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
      levels.current = { ...levels.current, input: normalizeLevel(Math.sqrt(sum / data.length)) };
      inputRaf.current = requestAnimationFrame(tick);
    };
    inputRaf.current = requestAnimationFrame(tick);
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
  /** Hand the call's microphone stream up (the recording hook captures THIS
   *  stream, not a second one it opened itself). */
  setMicStream?: (stream: MediaStream | null) => void;
  /** Where the two meters write, when this caller renders a presence orb. */
  levels?: { current: VoiceLevels };
  /** The directed call's data-channel hooks. Omitted ⇒ pre-director behaviour. */
  hooks?: OaiCallHooks;
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
    startOaiSpeakingMeter(refs, e.streams[0], ctx.setSpeaking, ctx.levels);
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
  ctx.setMicStream?.(mic);
  if (ctx.levels) startOaiInputMeter(refs, mic, ctx.levels);
  mic.getTracks().forEach((tr) => pc.addTrack(tr, mic));

  const dc = pc.createDataChannel("oai-events");
  refs.dc.current = dc;
  dc.onmessage = (e) => {
    try {
      applyOaiTranscriptEvent(JSON.parse(e.data as string), refs, ctx.pushTurn, ctx.hooks);
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
