"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider } from "@elevenlabs/react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Mic, MicOff, PhoneOff } from "lucide-react";
import { useErrorMessage } from "@/app/_lib/use-error-message";
// Provider id, transcript turn, and availability map are single-sourced in the
// voice adapter layer. Import from voice/types (not the package index, which
// pulls the server-only adapters into the bundle); these are type-only, so the
// import is erased at compile time.
import type { VoiceAvailability, VoiceProviderId, VoiceTurn } from "@/app/_lib/voice/types";
import { BTN_PRIMARY_LG, BTN_SECONDARY_LG } from "@/app/_components/ui/recipes";
import { canStart, voiceStartGate, type AvailabilityProbe } from "./availability-gate";
import { createTimerRegistry, type TimerCancel } from "./timer-registry";
// Default + fallback provider order, single-sourced in voice/types (browser-safe
// pure data) so the picker can't default to a different provider than the server's
// pickDefaultProvider — they previously kept inverted copies.
import { VOICE_PROVIDER_ORDER as PROVIDER_ORDER, DEFAULT_VOICE_PROVIDER as DEFAULT_PROVIDER } from "@/app/_lib/voice/types";
// Browser-safe pure helper (no server deps), so the "what counts as completed"
// decision is single-sourced and unit-tested rather than inline in a callback.
// unmountBeaconStatus decides the status a page-unload beacon persists (#5).
import { interviewFinalStatus, unmountBeaconStatus } from "@/app/_lib/voice/finalize-status";
// Pre-flight capability check (idea-b0fc8018) — same browser-safe pure-helper
// pattern; fails fast with an actionable message instead of letting
// getUserMedia throw the generic "Failed to start the call".
import { collectVoicePreflightEnv, voicePreflightCode } from "@/app/_lib/voice/preflight";
// The two realtime transports live side by side under transport/: OpenAI Realtime
// is raw WebRTC (a plain module of ref-driven functions), ElevenLabs is a thin hook
// around the SDK. Everything provider-specific — protocol buffers, teardown order,
// the drop debounce, the agent overrides — moved with them; what stays here is the
// shell they share: phase, consent, the transcript, and finalize().
import {
  sendToolResult,
  startOpenAiCall,
  teardownOpenAi as teardownOaiTransport,
  type OaiRefs,
  type VoiceLevels,
} from "./transport/openai";
import { startElevenLabsSession, useElevenLabsTransport } from "./transport/elevenlabs";
// …and the ONE contract the live call runs through once a session is open. The shell
// asks the transport what it can do (its capabilities), never which engine it is: the
// start() dispatch that picks the transport is the only provider-keyed line left here.
import {
  OAI_FINAL_TURN_GRACE_MS,
  elevenLabsCallTransport,
  openAiCallTransport,
  planEnd,
  sessionFromRef,
  type CallTransport,
} from "./transport/call-transport";
import { isVoiceTransportError } from "./transport/transport-error";
import { useMicTest } from "./useMicTest";
import { useSpeakerTest } from "./useSpeakerTest";
import { useTranscriptPersistence } from "./useTranscriptPersistence";
import { micErrorText } from "./micErrorText";
import { connectStartFailureMessage } from "./connect-start-failure";
import { PROVIDER_LABEL, portalLanguageHint, type LangHint, type Phase } from "./ui-types";
import { MicTestPanel } from "./MicTestPanel";
import { StatusPill } from "./VoiceStatusPill";
import { VoiceLiveControls } from "./VoiceLiveControls";
import { VoiceSettings } from "./VoiceSettings";
import { VoiceTranscript } from "./VoiceTranscript";
// The director loop (spark ai-interview-parity; ADR 0010). Everything about the
// producer channel lives in these four modules rather than in this shell: the wire
// discipline (director-channel), the React lifecycle (useDirector), the browser-only
// observations (useCallObservations) and the presence derivation (presence-state).
import { InterviewPresence } from "./InterviewPresence";
import { presenceState } from "./presence-state";
import { closingBegun, useDirector } from "./useDirector";
import { useCallObservations } from "./useCallObservations";
import { RecordingConsent, RecordingIndicator } from "./RecordingConsent";
import { useInterviewRecording } from "./useInterviewRecording";
import type {
  CandidateAgendaView,
  DirectorAgendaState,
  ResumeContext,
} from "@/app/_lib/voice/director-types";
import type { DirectedEndContext, InterviewEnding } from "@/app/_lib/voice/finalize-status";

// Live voice-interview MVP. OpenAI Realtime runs over raw WebRTC; ElevenLabs
// runs through the @elevenlabs/react SDK. A switcher lets you A/B both on the
// same short script. The server (/api/interview/connect) mints short-lived
// creds so no API key reaches the browser; the transcript is POSTed to
// /api/interview/complete on hang-up.

export type VoiceInterviewProps = {
  token?: string;
  candidateLabel?: string;
  jobTitle?: string;
  // Booked run-of-show length in minutes. The portal passes the grounded
  // duration so the live clock can show remaining vs elapsed; the lab omits it
  // and stays elapsed-only.
  durationMin?: number;
  // Candidate-portal mode (idea voice-3): pin the provider to the recruiter's
  // per-session choice and hide the provider/language picker, so a candidate can't
  // override the grounded provider the session was created for. The lab passes
  // neither and keeps the full A/B picker.
  provider?: VoiceProviderId;
  lockSettings?: boolean;
  // Spark ai-interview-parity. The portal page resolves both server-side, where the
  // token has already been redeemed:
  //  - whether this workspace OFFERS an audio recording (the separate, opt-in
  //    consent below the main one — WP3 owns what it then does);
  //  - the candidate's own /status link, so the closing card is a door rather than
  //    a cul-de-sac (the completed view has had one for a while; the live ending
  //    did not).
  recordingOffered?: boolean;
  statusHref?: string | null;
  /** Called whenever the director's agenda state moves, so the portal's sidebar can
   *  follow the interview. */
  onAgendaState?: (state: DirectorAgendaState) => void;
  /** Called once /connect answers with the agenda projection (or null). */
  onAgenda?: (agenda: CandidateAgendaView | null) => void;
};

// The two end-of-call graces (the closing-answer transcription grace and the
// disconnect grace) are declared by each transport as a CAPABILITY — see
// transport/call-transport.ts — and planEnd() reads them from there.

// How long "Connecting…" may last before we call it a failure. Covers a slow
// mic-permission prompt plus a cold provider handshake; past it the candidate is
// staring at a spinner that will never resolve.
const CONNECT_TIMEOUT_MS = 30000;

// How long a director tool call waits for a candidate utterance whose transcription
// is still in flight (spark ai-interview-parity). THE TRANSCRIPTION RACE: the model
// hears the answer and calls `mark_topic_covered` with the candidate's exact words
// before OpenAI's input transcription has finished — so the director checks the quote
// against a record that does not contain it yet, rejects a TRUE quote as `no_match`,
// and the interviewer spends a question re-asking something already answered (it was
// this feature's first documented known gap). Waiting up to 1.5 s and sending the turn
// in the SAME exchange closes it; past that the call proceeds rather than leaving the
// model blocked, because an un-recorded topic costs one question and a stalled tool
// call costs the interview.
const TOOL_TURN_GRACE_MS = 1500;

// How often the provisional interviewer caption is allowed to re-render the shell.
// `output_audio_transcript.delta` arrives tens of times a second and every one of them
// would otherwise be a render of this whole component; at 200 ms the caption still
// reads as live text while the call shell renders ~5 times a second.
const PARTIAL_CAPTION_THROTTLE_MS = 200;

/** Poll `done` every 100ms until it holds or `timeoutMs` elapses.
 *  `sleep` comes from the call's timer registry, so an unmount mid-poll both
 *  cancels the pending tick and RESOLVES this loop instead of leaving the
 *  finalize path awaiting a promise nothing will ever settle. */
async function waitUntil(done: () => boolean, timeoutMs: number, sleep: (ms: number) => Promise<void>): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!done() && Date.now() < deadline) {
    await sleep(100);
  }
}

export function VoiceInterview(props: VoiceInterviewProps) {
  // useConversation must live under a ConversationProvider.
  return (
    <ConversationProvider>
      <VoiceInterviewInner {...props} />
    </ConversationProvider>
  );
}

function VoiceInterviewInner({
  token,
  candidateLabel,
  jobTitle,
  durationMin,
  provider: pinnedProvider,
  lockSettings,
  recordingOffered,
  statusHref,
  onAgendaState,
  onAgenda,
}: VoiceInterviewProps) {
  const t = useTranslations("interview.voice");
  // Resolve API failures from the machine `code`, never from the server's
  // English `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  // The completed closing card reuses the SAME strings the portal page renders
  // server-side for an already-completed link (app/interview/[token]/page.tsx),
  // so the candidate sees one consistent ending whether they finish live or
  // reload — they live one namespace up from this component's "interview.voice".
  const tPortal = useTranslations("interview");
  const locale = useLocale();
  // micErrorText is a plain module (useTranslations is a hook), so it takes the
  // three already-translated recovery strings — same keys, same namespace.
  const micCopy = { denied: t("errMicDenied"), notFound: t("errMicNotFound"), busy: t("errMicBusy") };
  // THREE outcomes, not a nullable map: "asked and it failed" is not "have not
  // asked yet", and neither of them is "available" (availability-gate.ts).
  const [probe, setProbe] = useState<AvailabilityProbe>({ status: "loading" });
  const [probeNonce, setProbeNonce] = useState(0);
  // Re-run the availability probe. Shared by the Start control's check-again line
  // and the provider picker's, so the two controls cannot drift apart.
  const recheckAvailability = useCallback(() => {
    setProbe({ status: "loading" });
    setProbeNonce((n) => n + 1);
  }, []);
  // In locked (candidate) mode the provider is pinned to the session's stored value;
  // the lab starts on the default and lets the user pick.
  const [provider, setProvider] = useState<VoiceProviderId>(pinnedProvider ?? DEFAULT_PROVIDER);
  const [consent, setConsent] = useState(false);
  // The language picker is hidden on the candidate portal (lockSettings), so seed
  // the spoken-agent language hint from the candidate's UI locale — the agent then
  // speaks Czech for a cs visitor instead of falling to "auto". The lab keeps the
  // explicit "auto" default + the visible picker.
  const [language, setLanguage] = useState<LangHint>(lockSettings ? portalLanguageHint(locale) : "auto");
  const [phase, setPhase] = useState<Phase>("idle");
  // True only while the OS/browser microphone-permission prompt is open — drives an
  // actionable "grant the mic" hint so the candidate knows the wait is on THEM, not a
  // frozen "Connecting…".
  const [awaitingMic, setAwaitingMic] = useState(false);
  // HOW the call ended (set only in finalize, alongside phase → "ended").
  // "completed" means the session is terminal server-side: re-offering "Start
  // again" would just walk the candidate into a /connect 409, so the controls
  // give way to a closing card. "failed" (zero-turn hang-up, error blip,
  // never-live connect) keeps the retry button — the link is still usable.
  const [endedAs, setEndedAs] = useState<"completed" | "failed" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Two-click confirm before the (irreversible, terminal) End: a mis-click on the coral
  // End button previously ended the interview for good and locked the candidate out.
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  // H3: whether the interviewer's audio is currently playing. BOTH transports push it
  // through setSpeaking below (OpenAI from its AnalyserNode, ElevenLabs from the SDK's
  // mode), so the render reads one flag rather than asking which engine is serving.
  const [interviewerSpeaking, setInterviewerSpeaking] = useState(false);
  // M3: seconds elapsed while live (orientation for a nervous candidate). M4: mic mute state.
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  // bug-ui-scan-2026-07-09 (voice-interview #3): the OpenAI WebRTC path debounces a
  // "disconnected" ICE state for 8s before treating it as a drop; during that grace
  // nothing in the UI moved, so the candidate kept talking into a dead pipe. This
  // flags the degraded window so the StatusPill can say "reconnecting" immediately.
  const [unstable, setUnstable] = useState(false);
  // bug-ui-scan-2026-07-09 (voice-interview #4): AI OUTPUT (interviewer voice) mute —
  // distinct from the candidate mic mute above — and a recovery flag for when the
  // browser blocks autoplay of the hidden <audio>, so the load-bearing audio channel
  // has both a control and a "tap to enable" fallback.
  const [audioMuted, setAudioMuted] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  // ── the directed call (spark ai-interview-parity) ────────────────────────────
  // The model is generating but has not started speaking: the one stretch of a voice
  // call with no signal at all, which reads as a frozen page.
  const [thinking, setThinking] = useState(false);
  // The interviewer's line as it streams, before the turn finalizes. Throttled.
  const [interviewerPartial, setInterviewerPartial] = useState("");
  // The SEPARATE, opt-in audio-recording consent. Declining never blocks the call.
  const [recordingConsent, setRecordingConsent] = useState(false);
  // How many turns this transcript inherited from a dropped earlier attempt, so the
  // candidate is told they are continuing rather than starting over.
  const [resumedTurns, setResumedTurns] = useState(0);
  // The connected call's ids, as STATE (not refs): the recording hook is mounted
  // with them, and a hook argument read from a ref during render is a value React
  // cannot see change.
  const [liveSession, setLiveSession] = useState<{ sessionId: string; token: string; attempt: number } | null>(null);
  // The call's own microphone stream (OpenAI only — the ElevenLabs SDK owns its own),
  // handed to the recording hook so it captures the stream the call is using rather
  // than opening a second one.
  const [micStream, setMicStream] = useState<MediaStream | null>(null);

  // H5 follow-up: the pre-call mic test lives in its own hook — it shares nothing with
  // the call but the device, hence the two touchpoints (resetForCall / stopMicTest).
  const { micTest, micLevel, testMic, stopMicTest, resetForCall: resetMicTestForCall } = useMicTest();
  // …and its other half: can the candidate HEAR us? Keyless by construction (a
  // WebAudio tone, no asset and no provider) and purely advisory — see useSpeakerTest.
  const { speakerTest, playTone, confirmHeard, stopSpeakerTest, resetSpeakerForCall } = useSpeakerTest();

  // Refs avoid stale closures inside provider callbacks / teardown.
  const sessionIdRef = useRef<string | null>(null);
  // /complete demands the session token as the completion capability
  // (idea-5248c3e9). The portal/sim pages pass it as a prop; a lab session
  // receives it from /connect when the session is created.
  const sessionTokenRef = useRef<string | null>(null);
  // The live call's transport, set by start()'s dispatch once /connect has said which
  // engine actually serves (connect.provider carries the failover authority), and
  // cleared at the start of every attempt. Every live-call decision goes through it.
  const transportRef = useRef<CallTransport | null>(null);
  const turnsRef = useRef<VoiceTurn[]>([]);
  const finalizedRef = useRef(false);
  // End-of-call signals that decide completed-vs-failed (see finalize-status.ts):
  // whether the call ever went live, and whether a provider/network error fired.
  // The ElevenLabs SDK fires onDisconnect on EVERY close — including the one
  // right after onError — so we must not blindly persist those as "completed".
  const reachedLiveRef = useRef(false);
  const erroredRef = useRef(false);
  // bug-ui-scan-2026-07-09 (voice-interview #5): set the moment end() is invoked so
  // the unmount beacon can tell a clean, in-flight End (→ beacon the real verdict)
  // from a true mid-call abandonment (→ stay conservatively "failed"). A ref, not
  // state, because the unmount cleanup closure captures mount-time state.
  const endInFlightRef = useRef(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // H3: an AnalyserNode on the OpenAI remote (assistant) audio drives the speaking indicator —
  // the ElevenLabs SDK exposes isSpeaking but the raw-WebRTC OpenAI path has no equivalent, so
  // the pill was stuck on "Listening" for every OpenAI session. H4: a grace timer debounces a
  // transient ICE "disconnected" before we treat a mid-call network drop as terminal.
  const oaiAudioCtxRef = useRef<AudioContext | null>(null);
  const oaiRafRef = useRef<number | null>(null);
  const dropTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const asstBuf = useRef("");
  // The candidate side is asymmetric (idea-b70b8bd7): an utterance only becomes
  // a turn when its async transcription .completed event lands. candBuf collects
  // streamed transcription deltas (empty on whisper-1, which doesn't stream);
  // pendingCandidateRef tracks VAD speech_started → transcription completed, so
  // finalize knows a final answer is still in flight at hang-up.
  const candBuf = useRef("");
  const pendingCandidateRef = useRef(false);
  // ── refs the DIRECTED call adds ──────────────────────────────────────────────
  // The candidate-side analyser (the presence orb follows the microphone while the
  // interviewer listens) and the set of tool-call ids already answered.
  const oaiInputCtxRef = useRef<AudioContext | null>(null);
  const oaiInputRafRef = useRef<number | null>(null);
  const answeredCallsRef = useRef<Set<string>>(new Set());
  // Live audio levels, 0..1. A MUTABLE BOX, never state: the presence orb reads it on
  // its own animation frame, so a meter cannot re-render the call shell.
  const levelsRef = useRef<VoiceLevels>({ input: 0, output: 0 });
  // The interviewer's speaking flag, mirrored for the imperative getters (the end
  // handshake and `focus_lost.during` both ask outside of render).
  const speakingRef = useRef(false);
  // Whether a candidate utterance is still being transcribed, for BOTH providers.
  // Deliberately separate from pendingCandidateRef above, which is the OpenAI
  // finalize path's own signal and drives the "closing answer lost" system turn.
  const candidateTurnPendingRef = useRef(false);
  // The agenda this call is being directed against, and where the director says it
  // has got to — both read at finalize time, which is outside render.
  const agendaRef = useRef<CandidateAgendaView | null>(null);
  const agendaStateRef = useRef<DirectorAgendaState>({ activeBlockId: null, coveredBlockIds: [] });
  // HOW this call stopped. Null until something decides; a drop is the absence of a
  // decision, which is exactly what the finalize rule keys on.
  const endingKindRef = useRef<InterviewEnding | null>(null);
  const partialAtRef = useRef(0);
  // EVERY delayed callback this call schedules — the 30s connect timeout, the
  // ElevenLabs disconnect-grace fallback and the finalize poll — so unmount can
  // empty all of them instead of the one that happened to have a ref.
  const timersRef = useRef(createTimerRegistry());
  // M7: focus targets so keyboard/SR users aren't stranded when controls are swapped on a phase change.
  const endBtnRef = useRef<HTMLButtonElement | null>(null);
  const endedCardRef = useRef<HTMLDivElement | null>(null);

  // The ONE timer "clear the connect timer" may touch. It used to call
  // timersRef.current.clearAll() — the unmount teardown, which leaves the registry
  // inert for good — at the start of every call and again when it went live, so the
  // connect timeout was never armed, the ElevenLabs end fallback never fired, and
  // the closing-answer grace became a busy-loop (timer-registry.ts).
  const connectTimerCancelRef = useRef<TimerCancel | null>(null);
  const clearConnectTimer = useCallback(() => {
    connectTimerCancelRef.current?.();
    connectTimerCancelRef.current = null;
  }, []);

  // The interviewer's speaking flag goes to BOTH a ref (for the imperative getters
  // below, which run outside render) and to state (for the pill and the orb).
  const setSpeaking = useCallback((v: boolean) => {
    speakingRef.current = v;
    setInterviewerSpeaking(v);
    // Audio is playing: whatever the model was doing, it is no longer thinking.
    if (v) setThinking(false);
  }, []);
  const isInterviewerSpeaking = useCallback(() => speakingRef.current, []);

  /** The provisional interviewer caption, throttled. The deltas arrive tens of times
   *  a second; an empty string (the turn finalized) always lands immediately, because
   *  a caption left standing under a finalized turn is a duplicate the candidate
   *  reads twice. */
  const showInterviewerPartial = useCallback((text: string) => {
    const now = Date.now();
    if (text && now - partialAtRef.current < PARTIAL_CAPTION_THROTTLE_MS) return;
    partialAtRef.current = now;
    setInterviewerPartial(text);
  }, []);

  // The bundle transport/openai.ts operates on. Built on demand (never during
  // render) from the individual refs above rather than held as one object, so
  // every mutation the component itself performs stays a plain ref write — what
  // the React Compiler's immutability rule expects.
  const oaiRefs = useCallback(
    (): OaiRefs => ({
      pc: pcRef,
      mic: micRef,
      dc: dcRef,
      audio: audioRef,
      audioCtx: oaiAudioCtxRef,
      raf: oaiRafRef,
      dropTimer: dropTimerRef,
      asstBuf,
      candBuf,
      pendingCandidate: pendingCandidateRef,
      inputCtx: oaiInputCtxRef,
      inputRaf: oaiInputRafRef,
      answeredCalls: answeredCallsRef,
    }),
    []
  );

  const teardownOpenAi = useCallback(() => {
    teardownOaiTransport(oaiRefs(), {
      setSpeaking,
      setUnstable,
      setAudioBlocked,
      setMicStream,
      levels: levelsRef,
    });
  }, [oaiRefs, setSpeaking]);

  // ── the director loop ────────────────────────────────────────────────────────
  // The ElevenLabs conversation object is rebuilt every render and is created BELOW
  // (its hook needs pushTurn, which needs the director). A ref breaks that knot
  // without making any of the three callbacks unstable.
  const conversationRef = useRef<ReturnType<typeof useElevenLabsTransport> | null>(null);
  // A STABLE session over that ref: the ElevenLabs transport is built on it, and its
  // identity is how the SDK's callbacks know they belong to the call being served.
  const [elSession] = useState(() => sessionFromRef(conversationRef));

  /** Inject ONE stage direction into whichever transport is serving. `text` already
   *  carries the server's `[Director] ` prefix and goes in VERBATIM. */
  const injectDirective = useCallback(
    (text: string) => {
      const sent = transportRef.current?.injectDirective(text) ?? false;
      if (!sent) {
        // An undelivered direction is a call that keeps running undirected — the
        // documented degrade — but it is also the only symptom an operator would
        // ever see of a transport that stopped accepting them.
        console.warn("[voice] a director stage direction could not be delivered to the provider.");
      }
    },
    [],
  );

  // The SAME teardown the End button runs — one end path, so a call is finalized,
  // persisted and classified identically however it was decided to stop. Through a
  // latest-ref rather than a direct closure: `end` is re-created every render (it
  // reads half the component's state), and the director must not have to re-arm its
  // loop every time this shell re-renders.
  const endFnRef = useRef<(kind: InterviewEnding) => void>(() => {});
  useEffect(() => {
    endFnRef.current = (kind: InterviewEnding) => void end(kind);
  });
  const requestDirectorEnd = useCallback(() => endFnRef.current("director_end"), []);

  const director = useDirector({
    injectDirective,
    isInterviewerSpeaking,
    requestEnd: requestDirectorEnd,
    timers: timersRef,
  });

  // Browser-only observations. They change NOTHING the candidate sees (see the
  // hook's header): they are recorded, never scored, never shown as judgement.
  const observations = useCallObservations({
    live: phase === "live",
    isInterviewerSpeaking,
    onEvent: director.recordEvent,
  });

  // Keep the portal's sidebar in step with the director, and hold the two values
  // finalize reads after the call is already over.
  const { agendaState } = director;
  useEffect(() => {
    agendaStateRef.current = agendaState;
    onAgendaState?.(agendaState);
  }, [agendaState, onAgendaState]);

  const pushTurn = useCallback(
    (role: VoiceTurn["role"], text: string) => {
      const t = (text ?? "").trim();
      if (!t) return;
      const turn: VoiceTurn = { role, text: t, at: new Date().toISOString() };
      turnsRef.current = [...turnsRef.current, turn];
      setTurns(turnsRef.current);
      // `system` turns are OUR notes about the transcript (the lost-closing-answer
      // marker), not the conversation — they are persisted with the transcript at
      // hang-up and have no place in the director's turn numbering.
      if (role === "system") return;
      const seq = director.recordTurn(role, t);
      // The real turn is now in the log above; the provisional caption of the same
      // words would be the candidate reading it twice.
      if (role === "interviewer") showInterviewerPartial("");
      if (role === "candidate") {
        candidateTurnPendingRef.current = false;
        observations.noteCandidateTurn(seq);
      }
    },
    [director, observations, showInterviewerPartial],
  );

  const { saveFailed, setSaveFailed, discardedTurns, setDiscardedTurns, persistTranscript, retrySave } =
    useTranscriptPersistence({
      token,
      sessionIdRef,
      sessionTokenRef,
      turnsRef,
      endedAs,
    });

  const finalize = useCallback(
    async (status: "completed" | "failed") => {
      if (finalizedRef.current) return;
      finalizedRef.current = true;
      clearConnectTimer();
      // The candidate's LAST answer is the asymmetric gap (idea-b70b8bd7): the
      // assistant side is buffered locally (flushed below), but a candidate
      // utterance only becomes a turn when its async transcription .completed
      // event arrives. A candidate who finishes speaking and immediately clicks
      // End would have that final — often most decision-relevant — answer
      // silently dropped from the transcript that feeds the scorecard. When the
      // transport finalizes immediately and an utterance is pending at hang-up,
      // planEnd says: stop capture (so server VAD sees end-of-speech and
      // transcribes what it heard) but keep the channel open briefly to receive it.
      // (A disconnect-finalizing transport already had its grace before its close
      // drove this call, so its plan has nothing for finalize to do.)
      if (status === "completed") {
        const transport = transportRef.current;
        const plan = planEnd(transport?.capabilities, {
          pendingCandidate: pendingCandidateRef.current,
          channelOpen: dcRef.current?.readyState === "open",
        });
        if (transport && plan.stopCaptureThenWaitMs) {
          transport.stopCapture();
          await waitUntil(() => !pendingCandidateRef.current, plan.stopCaptureThenWaitMs, (ms) => timersRef.current.sleep(ms));
        }
      }
      // Flush any AI turn still buffered from output_audio_transcript.delta
      // events. Teardown can fire before the matching .done arrives (the
      // candidate hangs up mid-sentence, or .done never lands), which would
      // otherwise silently drop the final interviewer turn from the transcript
      // that feeds the scorecard. pushTurn updates turnsRef synchronously, so
      // the flushed turn is included in the POST body below.
      pushTurn("interviewer", asstBuf.current);
      asstBuf.current = "";
      // Grace expired with the utterance still pending: fall back to whatever
      // transcription deltas streamed in (empty on a non-streaming model like
      // whisper-1 — then the turn is genuinely unrecoverable, but we no longer drop
      // one we already hold). Surface that loss instead of dropping it silently, so a
      // scorecard scored on a missing closing answer is at least observable.
      if (pendingCandidateRef.current && !candBuf.current.trim()) {
        // The loss used to be a console.warn — visible to nobody who reads the
        // scorecard. Record it IN BAND instead, as a system turn, which is the
        // path 645f49d1 already established for transcript integrity: a system
        // turn is persisted with the transcript by /api/interview/complete, read
        // by the scorer (transcriptToNotes prefixes it "System:") and rendered by
        // the recruiter's transcript modal (ScheduleInterviewTranscriptTurns) —
        // exactly like capTranscriptTurns' "turns omitted" marker. So a scorecard
        // scored without the candidate's closing answer says so, in the record.
        pushTurn("system", t("closingTurnLostNote"));
        console.warn(
          `[voice] final candidate turn lost: transcription grace (${OAI_FINAL_TURN_GRACE_MS}ms) expired with an empty delta buffer — the closing answer is missing from the scored transcript (use a streaming OPENAI_REALTIME_TRANSCRIPTION_MODEL to populate the fallback).`
        );
      }
      pushTurn("candidate", candBuf.current);
      candBuf.current = "";
      pendingCandidateRef.current = false;
      // The producer channel closes with the call: a queued tool call is answered
      // (the model is never left waiting) and nothing posts to a session that is
      // about to be finalized.
      director.stop();
      teardownOpenAi();
      setPhase("ended");
      setEndedAs(status);
      setThinking(false);
      setInterviewerPartial("");
      // bug-ui-scan-2026-07-09 (voice-interview #2): a substantive call that ended on
      // a late transport blip still finalizes "completed" (interviewFinalStatus) and
      // WILL be scored — clear the transient connection error (set by onError / the
      // OpenAI drop) so the success closing card isn't contradicted by a red banner.
      if (status === "completed") setError(null);
      const sid = sessionIdRef.current;
      const tok = sessionTokenRef.current ?? token ?? null;
      if (sid && tok) {
        const { saved, discardedTurns: discarded } = await persistTranscript(tok, sid, turnsRef.current, status);
        // Two different endings, and only one of them is a retryable failure. A
        // REFUSED save (another window's call for this link finished first) used to
        // land here as `!saved` and got the Retry banner — a button that could only
        // ever be refused again — while the closing card above still said the
        // interview was complete. It now says what actually happened to the turns.
        if (!saved && discarded === 0) setSaveFailed(true);
      }
    },
    [teardownOpenAi, clearConnectTimer, pushTurn, persistTranscript, setSaveFailed, token, t, director]
  );

  // M3: tick the elapsed timer while live so a nervous candidate can orient (am I 3 or 18 min in?).
  useEffect(() => {
    if (phase !== "live") return;
    const started = Date.now();
    const tick = () => setElapsed(Math.floor((Date.now() - started) / 1000));
    // Reset via a scheduled callback (not synchronously in the effect body) —
    // the zero-delay timeout fires before the first 1s tick, so the display
    // still restarts at 0:00 on the phase change.
    const reset = window.setTimeout(() => setElapsed(0), 0);
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(reset);
      window.clearInterval(id);
    };
  }, [phase]);

  // M7: move focus to the now-relevant control when the controls are swapped on a phase change,
  // so keyboard/SR users aren't left on a button that no longer exists.
  useEffect(() => {
    if (phase === "live") endBtnRef.current?.focus();
    else if (phase === "ended") endedCardRef.current?.focus();
  }, [phase]);

  // The presence orb's levels, for a transport that does not push them itself
  // (capabilities.levels === "sampled"): poll it on an animation frame while the call
  // is up. Before this, nothing wrote levelsRef on an ElevenLabs call and the orb sat
  // flat for the whole interview. The loop dies with the live phase however the call
  // ended — an End, a dropped socket, an error — and leaves a still ring behind it.
  const callUp = phase === "live" || phase === "ending";
  useEffect(() => {
    if (!callUp) return;
    const transport = transportRef.current;
    if (!transport || transport.capabilities.levels !== "sampled") return;
    const levels = levelsRef;
    let raf = requestAnimationFrame(function tick() {
      transport.sampleLevels(levels);
      raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(raf);
      levels.current = { input: 0, output: 0 };
    };
  }, [callUp]);

  // M4: mute/unmute the candidate's microphone for a "give me a moment" without ending the call.
  function toggleMute() {
    const next = !muted;
    setMuted(next);
    // A transport that is not ready answers false; the state still reflects intent.
    transportRef.current?.setMicMuted(next);
  }

  // bug-ui-scan-2026-07-09 (voice-interview #4): mute/unmute the AI's OUTPUT voice —
  // the load-bearing channel of a voice interview — which previously had no control
  // at all (only the candidate mic was muteable). HOW the voice is muted (the hidden
  // <audio> element, or the SDK volume) is the transport's business.
  function toggleAudioMuted() {
    const next = !audioMuted;
    setAudioMuted(next);
    transportRef.current?.setOutputMuted(next);
  }

  // bug-ui-scan-2026-07-09 (voice-interview #4): recover from a blocked autoplay by
  // re-invoking play() from the user gesture the browser requires. Cleared on
  // success; a persistent failure leaves the button so the candidate can retry.
  function enableAudio() {
    const el = audioRef.current;
    if (!el) return;
    void el
      .play()
      .then(() => setAudioBlocked(false))
      .catch(() => {
        /* still blocked — keep the affordance visible */
      });
  }

  // The completed-vs-failed verdict, read from the live refs at call time. Every
  // end path (EL onDisconnect, the EL fallback timer, the OpenAI inline branch)
  // asks the same single question, so building it here keeps the three sites from
  // classifying the same call differently. The provider branching (WHEN finalize
  // fires) stays at the call sites.
  // What the DIRECTOR knew when the call stopped. A directed call that DROPS before
  // its closing block is now "failed" on purpose — `failed` keeps the link
  // reconnectable and the reconnect resumes the same agenda, so the candidate can
  // finish rather than being locked out at minute 12 of 30 with half an interview
  // scored (see voice/finalize-status.ts).
  const currentDirection = (): DirectedEndContext => ({
    directed: agendaRef.current !== null,
    ending: endingKindRef.current ?? "drop",
    closingBegun: closingBegun(agendaRef.current, agendaStateRef.current),
  });

  const currentFinalStatus = () =>
    interviewFinalStatus(
      {
        errored: erroredRef.current,
        reachedLive: reachedLiveRef.current,
        turnCount: turnsRef.current.length,
        candidateTurnCount: turnsRef.current.filter((t) => t.role === "candidate").length,
      },
      currentDirection(),
    );

  /** One director tool call, end to end, for whichever provider asked. ALWAYS
   *  resolves with the string to hand the model — "Continue with the agenda." when
   *  the director could not be reached, so a producer outage costs direction and not
   *  the interview. */
  const runToolCall = useCallback(
    async (call: { callId: string; name: string; args: unknown }): Promise<string> => {
      // THE TRANSCRIPTION RACE: the model quotes an answer whose transcription has
      // not landed yet. Hold the exchange for it (bounded) so the quote is checked
      // against a record that contains it.
      const awaitTurn = candidateTurnPendingRef.current
        ? () =>
            waitUntil(
              () => !candidateTurnPendingRef.current,
              TOOL_TURN_GRACE_MS,
              (ms) => timersRef.current.sleep(ms),
            )
        : undefined;
      return director.callTool(call, awaitTurn);
    },
    [director],
  );

  const conversation = useElevenLabsTransport({
    isFinalized: () => finalizedRef.current,
    // The SDK's callbacks belong to this call only while the serving transport drives
    // THIS SDK session — a late event from an earlier attempt, or one arriving while a
    // new attempt has no transport yet, is not this call's.
    isActiveProvider: () => transportRef.current?.handle === elSession,
    onConnected: () => {
      clearConnectTimer();
      reachedLiveRef.current = true;
      setPhase("live");
    },
    onClosed: () => void finalize(currentFinalStatus()),
    hooks: {
      onMode: (mode) => {
        setSpeaking(mode === "speaking");
        // The SDK's mode is also the only signal that the agent's audio FINISHED —
        // the pre-answer silence is measured from it.
        if (mode === "listening") observations.noteInterviewerAudio("done");
        else observations.noteInterviewerAudio("started");
      },
      onCandidateSpeech: (state) => {
        if (state === "started") candidateTurnPendingRef.current = true;
        observations.noteCandidateSpeech(state);
        // The model is about to be handed a turn: from here until its audio starts
        // is the "thinking" stretch.
        if (state === "stopped") setThinking(true);
      },
      onInterviewerPartial: (text) => showInterviewerPartial(text),
    },
    onError: (message: string, cause?: unknown) => {
      clearConnectTimer();
      erroredRef.current = true;
      // Parity with the OpenAI path, which runs every start failure through
      // micErrorText in start()'s catch. The ElevenLabs SDK acquires the mic
      // ITSELF and rethrows the raw getUserMedia rejection, and its provider
      // surfaces a rejected startSession as onError(error.message, error) — so
      // this callback is the ONLY place an EL mic denial lands (the SDK's
      // startSession returns void, which makes the promise branch in
      // startElevenLabsSession unreachable on this version). Without the mapping
      // a candidate who denied the mic — the most common real failure of a voice
      // screen — was shown the SDK's untranslated "Permission denied" with no
      // recovery step, in every locale, while the same denial on OpenAI got the
      // full "click the microphone icon in your address bar" copy.
      // `message` is the SDK's own English string (often carrying provider
      // detail) — it goes to the console for the operator, never to the
      // candidate's banner. What they read is a mic recovery step or our own
      // localized session line.
      if (message) console.error(`[voice] ElevenLabs session error: ${message}`);
      setError(micErrorText(cause ?? message, micCopy) ?? t("errVoiceSession"));
      setPhase("error");
    },
    pushTurn,
  });

  // The SDK object is rebuilt every render; the director's directive injection reads
  // it through this ref so its callback can stay stable.
  useEffect(() => {
    conversationRef.current = conversation;
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/interview/connect")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`probe ${r.status}`))))
      .then((d) => {
        if (cancelled) return;
        const avail: VoiceAvailability | null = d.availability ?? null;
        // A 200 with no availability map tells us nothing either — treat it as a
        // failed probe rather than silently as "everything is configured".
        setProbe(avail ? { status: "ok", availability: avail } : { status: "failed" });
        // Never leave the picker on a provider whose keys are missing: if the
        // default (ElevenLabs) isn't configured, drop to the first one that is.
        // Skip in locked (candidate) mode — the recruiter's pinned provider must
        // stand; an unconfigured one surfaces "keys not configured" rather than
        // silently switching the candidate onto a different, ungrounded provider.
        if (avail && !lockSettings) setProvider((cur) => (avail[cur] ? cur : (PROVIDER_ORDER.find((p) => avail[p]) ?? cur)));
      })
      .catch(() => {
        // The bug this replaced: `setAvailability(null)` here made a failed probe
        // indistinguishable from "not asked yet", and the render read that as
        // AVAILABLE — so a keyless or unreachable server showed a normal Start
        // that died at connect, and the honest unavailable copy was dead code.
        if (!cancelled) setProbe({ status: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [probeNonce]);

  // Teardown on unmount.
  useEffect(() => {
    // A remount (React's dev StrictMode runs mount → cleanup → mount) finds the
    // registry the first cleanup tore down, and a cleared registry is inert for
    // good — every timer this call schedules would silently no-op. Each mount owns
    // a live one.
    if (timersRef.current.cleared) timersRef.current = createTimerRegistry();
    // Copied inside the effect: the cleanup must clear THIS call's registry, not
    // whatever the ref points at by the time React runs the teardown.
    const timers = timersRef.current;
    return () => {
      timers.clearAll();
      // Close whatever channel is serving (idempotent, never throws).
      transportRef.current?.end();
      // Flush a partial transcript on unmount (tab close / back-navigation) so a
      // real in-progress interview isn't lost silently. Only when the call went
      // live and wasn't already finalized; sendBeacon survives unload where a
      // normal fetch would be cancelled. bug-ui-scan-2026-07-09 (voice-interview #5):
      // the status is no longer hardcoded "failed" — a clean End already in flight
      // (endInFlightRef) beacons the real verdict, so a substantive call that ended
      // cleanly a fraction before the tab closed is persisted "completed" and scored,
      // while a true mid-call abandonment stays conservatively "failed".
      if (!finalizedRef.current && reachedLiveRef.current) {
        finalizedRef.current = true;
        const sid = sessionIdRef.current;
        const tok = sessionTokenRef.current ?? token ?? null;
        if (sid && tok) {
          try {
            const status = unmountBeaconStatus(
              endInFlightRef.current,
              {
                errored: erroredRef.current,
                reachedLive: reachedLiveRef.current,
                turnCount: turnsRef.current.length,
                candidateTurnCount: turnsRef.current.filter((t) => t.role === "candidate").length,
              },
              // A directed call abandoned before its closing block beacons the
              // RESUMABLE verdict, not a terminal "completed" that would lock the
              // candidate out of a link they can still finish.
              {
                directed: agendaRef.current !== null,
                ending: endingKindRef.current ?? "drop",
                closingBegun: closingBegun(agendaRef.current, agendaStateRef.current),
              },
            );
            const blob = new Blob(
              [JSON.stringify({ token: tok, sessionId: sid, transcript: turnsRef.current, status })],
              { type: "application/json" }
            );
            navigator.sendBeacon("/api/interview/complete", blob);
          } catch {
            /* best-effort */
          }
        }
      }
      teardownOpenAi();
      stopMicTest();
      stopSpeakerTest();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // H4: a mid-call network drop on the raw-WebRTC OpenAI path (no onDisconnect like ElevenLabs)
  // otherwise froze the call "live" forever with a hot mic. Save what we have and surface a
  // reconnectable error instead of hanging.
  function handleOaiDrop() {
    if (finalizedRef.current || !reachedLiveRef.current) return;
    erroredRef.current = true;
    // Nobody decided this. `endingKindRef` stays whatever an in-flight End already
    // set — a drop a fraction after the candidate pressed End is still their End.
    if (endingKindRef.current === null) endingKindRef.current = "drop";
    const status = currentFinalStatus();
    // bug-ui-scan-2026-07-09 (voice-interview #2): only alarm the candidate when the
    // drop actually fails the screen. A drop AFTER a substantive conversation
    // finalizes "completed" (interviewFinalStatus) and is still scored, so it earns
    // the success card — not a "connection dropped, press Start to reconnect" error.
    if (status === "failed") setError(t("errConnectionLost"));
    void finalize(status);
  }

  async function start() {
    setConfirmingEnd(false);
    setSaveFailed(false);
    setDiscardedTurns(0);
    setMuted(false);
    setElapsed(0);
    resetMicTestForCall(); // release the test mic before the real call claims the device
    resetSpeakerForCall(); // …and the speaker test's audio context
    // Pre-flight BEFORE dialing (idea-b0fc8018): an in-app webview, a plain-HTTP
    // link, or a WebRTC-less browser is the most common real-world failure of a
    // first-round screen — name the root cause and the fix, and never burn a
    // /connect call (which mints provider credentials) on a doomed environment.
    const preflight = voicePreflightCode(collectVoicePreflightEnv(), provider);
    if (preflight) {
      setError(errMsg({ code: preflight }, t("errStartCall")));
      setPhase("error");
      return;
    }
    setError(null);
    setEndedAs(null);
    setTurns([]);
    turnsRef.current = [];
    asstBuf.current = "";
    candBuf.current = "";
    pendingCandidateRef.current = false;
    finalizedRef.current = false;
    reachedLiveRef.current = false;
    erroredRef.current = false;
    // bug-ui-scan-2026-07-09 (voice-interview #3/#4/#5): clear the per-call transient
    // UI/verdict state so a retry never inherits the previous call's degraded pill,
    // blocked-audio banner, output-mute, or in-flight-End flag.
    endInFlightRef.current = false;
    setUnstable(false);
    setAudioMuted(false);
    setAudioBlocked(false);
    // …and the DIRECTED call's own per-attempt state. A retry is a new attempt:
    // new turn numbering, a fresh agenda state, no stale ending verdict, and no
    // caption left over from the call that dropped.
    director.stop();
    agendaRef.current = null;
    agendaStateRef.current = { activeBlockId: null, coveredBlockIds: [] };
    endingKindRef.current = null;
    candidateTurnPendingRef.current = false;
    speakingRef.current = false;
    levelsRef.current = { input: 0, output: 0 };
    setThinking(false);
    setInterviewerPartial("");
    setResumedTurns(0);
    setLiveSession(null);
    setMicStream(null);
    // Clear the prior call's session capability ids too: a re-connect that fails
    // before /connect returns fresh ones must not let finalize POST against the
    // previous (already-completed) session.
    sessionIdRef.current = null;
    sessionTokenRef.current = null;
    // No transport until /connect says which engine serves this attempt.
    transportRef.current = null;
    setPhase("connecting");
    // Never hang on "Connecting…": if we aren't live within 30s, surface an error.
    clearConnectTimer();
    connectTimerCancelRef.current = timersRef.current.set(() => {
      connectTimerCancelRef.current = null;
      finalizedRef.current = true; // don't POST a transcript for a failed connect
      transportRef.current?.end();
      teardownOpenAi();
      setError(t("errConnectTimeout"));
      setPhase("error");
    }, CONNECT_TIMEOUT_MS);
    try {
      const res = await fetch("/api/interview/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          token,
          consent,
          // The SEPARATE audio-recording consent. Only a literal `true` counts
          // server-side, and only a workspace that offers recording can receive it.
          recordingConsent: recordingOffered === true && recordingConsent,
          language: language === "auto" ? undefined : language,
        }),
      });
      const data = await res.json();
      // /api/interview/connect answers with `{ error, code }` — resolve the
      // code; `error` is English for the server log. Do not throw into the
      // generic catch: that path discarded e.message for t("errStartCall")
      // and hid INTERVIEW_ALREADY_LIVE / EXPIRED / INACTIVE / ALREADY_COMPLETED.
      if (!res.ok) {
        clearConnectTimer();
        setError(
          connectStartFailureMessage(data, errMsg, t("errStartCall"), (minutes) =>
            t("retryAfterMinutes", { minutes }),
          ),
        );
        setPhase("error");
        teardownOpenAi();
        return;
      }
      sessionIdRef.current = data.sessionId;
      sessionTokenRef.current = (typeof data.token === "string" ? data.token : null) ?? token ?? null;
      const c = data.connect;
      // The server may have FAILED OVER to the other provider (the preferred one's
      // connect threw and the alternate was available). connect.provider is
      // authoritative: the transport dispatch below is keyed on what actually
      // served, not what we requested, and the picker follows it.
      if (c?.provider && c.provider !== provider) setProvider(c.provider);

      // ── arm the director for this attempt (spark ai-interview-parity) ────────
      const agenda: CandidateAgendaView | null =
        data.agenda && Array.isArray(data.agenda.blocks) ? (data.agenda as CandidateAgendaView) : null;
      const resume: ResumeContext | null =
        data.resume && Array.isArray(data.resume.priorTurns) ? (data.resume as ResumeContext) : null;
      const attempt = Number.isSafeInteger(data.attempt) && data.attempt > 0 ? (data.attempt as number) : 1;
      agendaRef.current = agenda;
      onAgenda?.(agenda);
      // A RESUMED attempt inherits the earlier attempts' turns into the VISIBLE
      // transcript — and into the transcript /complete finally stores, so the record
      // is the whole interview rather than whatever happened after the drop. Their
      // own seq numbers belong to their own attempts; this attempt's numbering
      // starts at 0 again (the director keys idempotence on attempt + seq), which is
      // why they are seeded straight into turnsRef instead of through pushTurn.
      if (resume && resume.priorTurns.length > 0) {
        turnsRef.current = resume.priorTurns.map((pt) => ({ role: pt.role, text: pt.text, at: pt.at }));
        setTurns(turnsRef.current);
        setResumedTurns(resume.priorTurns.length);
      }
      const sessionToken = sessionTokenRef.current;
      if (typeof data.sessionId === "string" && sessionToken) {
        setLiveSession({ sessionId: data.sessionId, token: sessionToken, attempt });
        director.begin({ token: sessionToken, sessionId: data.sessionId, attempt, agenda, resume });
      }

      // THE one provider-keyed line in this shell: opening a session takes
      // engine-specific inputs (an SDP exchange with a client secret vs an SDK signed
      // URL with overrides), so this dispatch CHOOSES the transport. Everything after
      // it — mute, directives, levels, the end handshake, teardown — asks the transport.
      if (c.provider === "openai") {
        transportRef.current = openAiCallTransport(oaiRefs(), {
          setSpeaking,
          setUnstable,
          setAudioBlocked,
          setMicStream,
          levels: levelsRef,
        });
        await startOpenAiCall(c, {
          refs: oaiRefs(),
          finalizedRef,
          reachedLiveRef,
          pushTurn,
          setSpeaking,
          setUnstable,
          setAudioBlocked,
          setAwaitingMic,
          setLive: () => setPhase("live"),
          clearConnectTimer,
          onDrop: handleOaiDrop,
          setMicStream,
          levels: levelsRef,
          hooks: {
            onInterviewerPartial: showInterviewerPartial,
            onCandidateSpeech: (state) => {
              if (state === "started") candidateTurnPendingRef.current = true;
              else setThinking(true);
              observations.noteCandidateSpeech(state);
            },
            onInterviewerAudio: (state) => observations.noteInterviewerAudio(state),
            onGenerating: () => setThinking(true),
            // The model is BLOCKED on this result — answer it whatever happens, and
            // hand the answer back over the same data channel.
            onToolCall: (call) => {
              void runToolCall(call).then((result) => {
                if (!sendToolResult(oaiRefs(), call.callId, result)) {
                  console.warn(`[voice] could not answer tool call ${call.callId}: the data channel is gone.`);
                }
              });
            },
          },
        });
      } else {
        transportRef.current = elevenLabsCallTransport(elSession);
        startElevenLabsSession({
          conversation,
          signedUrl: c.signedUrl,
          agentPrompt: data.agentPrompt ?? undefined,
          asrKeywords: Array.isArray(data.asrKeywords) ? data.asrKeywords : undefined,
          language,
          // The SDK answers the model with whatever this resolves to, so the
          // fallback path is the same one OpenAI takes: never a rejection, never a
          // 10-second platform timeout.
          onToolCall: runToolCall,
          onAsyncError: (err) => {
            clearConnectTimer();
            if (err instanceof Error) console.error(`[voice] ElevenLabs connect failed: ${err.message}`);
            setError(micErrorText(err, micCopy) ?? t("errElevenConnect"));
            setPhase("error");
          },
        });
      }
    } catch (e) {
      clearConnectTimer();
      // Three sources, one rule: a mic failure gets its recovery copy, a CODED
      // transport failure gets errors.<CODE> in the reader's language, and
      // anything else gets our own generic line. The thrown message — which for
      // the realtime transport used to be the provider's response body verbatim —
      // is never what the candidate reads.
      const transportCode = isVoiceTransportError(e) ? e.code : null;
      if (e instanceof Error) console.error(`[voice] start failed: ${e.message}`);
      setError(
        micErrorText(e, micCopy) ??
          (transportCode ? errMsg({ code: transportCode }, t("errStartCall")) : t("errStartCall"))
      );
      setPhase("error");
      teardownOpenAi();
    }
  }

  /** The ONE teardown. `kind` says who decided: the candidate's End button, or the
   *  director (its `end_interview`, the close reserve, the client hard stop). It is
   *  what tells the finalize rule this was a DECISION and not a dropped socket. */
  async function end(kind: InterviewEnding = "candidate_end") {
    if (endingKindRef.current === null) endingKindRef.current = kind;
    setPhase("ending");
    // The producer channel has nothing left to say, and a tool call still queued is
    // answered rather than left hanging on a socket that is closing.
    director.stop();
    // bug-ui-scan-2026-07-09 (voice-interview #5): mark a clean End in flight so an
    // unmount that races ahead of ElevenLabs onDisconnect beacons the REAL verdict
    // (completed for a substantive call) instead of a hardcoded "failed".
    endInFlightRef.current = true;
    const transport = transportRef.current;
    const plan = planEnd(transport?.capabilities, {
      pendingCandidate: pendingCandidateRef.current,
      channelOpen: dcRef.current?.readyState === "open",
    });
    if (transport && plan.endSessionThenWaitMs) {
      // A disconnect-finalizing transport: defer finalize to its close so the
      // candidate's final answer — which the engine delivers a few hundred ms AFTER
      // the end request — is captured before turnsRef is snapshotted. Synchronously
      // finalizing here latched finalizedRef first and dropped that closing turn. The
      // timer is a fallback for a close that never lands.
      transport.end();
      timersRef.current.set(() => {
        if (!finalizedRef.current) {
          void finalize(currentFinalStatus());
        }
      }, plan.endSessionThenWaitMs);
      return;
    }
    // Finalize now (finalize itself holds for a closing answer still in flight).
    // Derive completed-vs-failed from the same signals as every other end path
    // instead of hardcoding "completed": a zero-turn hang-up (silent mic,
    // transcription failure, mistaken early End) previously locked the session
    // terminal-completed, so the candidate was permanently shut out of their own
    // link; interviewFinalStatus returns "failed" for turnCount 0, keeping it
    // reconnectable.
    await finalize(currentFinalStatus());
  }

  const isBusy = phase === "connecting" || phase === "live" || phase === "ending";
  const liveProvider = provider;
  // Three-state (availability-gate.ts): "unknown" is a failed probe and is NOT
  // permission to render a Start that cannot work.
  const startGate = voiceStartGate(probe, liveProvider);
  const providerAvailable = canStart(startGate);

  const liveOrEnding = phase === "live" || phase === "ending";
  // ONE derivation for the orb, the pill and the live region (presence-state.ts):
  // three surfaces re-deriving "is the interviewer talking" could disagree inside
  // the same frame, and did.
  // `interviewerSpeaking` is the one flag both transports push (setSpeaking).
  const presence = presenceState({ phase, interviewerSpeaking, thinking });

  // Audio recording: this shell mounts it with the call's own microphone stream and
  // the consent the candidate gave, and renders the one chip it is allowed during
  // the call. Everything else about it — capture, chunking, upload, retention — is
  // behind these exact arguments.
  const { state: recordingState } = useInterviewRecording({
    offered: recordingOffered === true,
    consent: recordingConsent,
    token: liveSession?.token ?? null,
    sessionId: liveSession?.sessionId ?? null,
    attempt: liveSession?.attempt ?? 1,
    micStream,
    active: phase === "live",
  });

  return (
    <div className="space-y-6">
      <audio ref={audioRef} autoPlay hidden />

      {/* Settings — language + provider, side by side. Hidden on the candidate
          portal (lockSettings): the provider is pinned to the session and the
          candidate must not see/override these internal A/B controls. Shown only
          in the lab. Both lock once a call is in flight. */}
      {!lockSettings && (
        <VoiceSettings
          language={language}
          onLanguage={setLanguage}
          provider={provider}
          onProvider={setProvider}
          probe={probe}
          onRecheck={recheckAvailability}
          isBusy={isBusy}
        />
      )}

      {/* A COMPLETED ending swaps the consent + start controls for a closing
          card: the session is terminal server-side, so "Start again" was a dead
          button (/connect 409 → "already completed"). Failed endings — zero-turn
          hang-up, error blip, the 30s connect timeout (phase "error", endedAs
          null) — keep the retry controls so the still-live link stays usable.
          The transcript stays mounted below as the candidate's record. */}
      {phase === "ended" && endedAs === "completed" ? (
        // M7: focusable (tabIndex -1) so focus lands here when the call ends. M8: a concrete
        // next-steps line so the ending doesn't feel like a void.
        <div
          ref={endedCardRef}
          role="status"
          tabIndex={-1}
          className="focus-ring rounded-lg border border-moss/40 bg-moss/5 px-5 py-8 text-center"
        >
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-moss/15 text-moss">
            <CheckCircle2 size={24} aria-hidden />
          </span>
          <h2 className="mt-3 font-serif text-h2 text-ink">{tPortal("completedTitle")}</h2>
          <p className="mx-auto mt-1.5 max-w-md text-base leading-6 text-steel">{tPortal("completedBody")}</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-steel">{t("completedNext")}</p>
          {/* Not a cul-de-sac. The already-completed RELOAD of this page has handed
              the candidate their durable /status link for a while; the ending they
              actually experience — the live one — did not, so the same interview
              ended two different ways depending on when you looked at it. */}
          {statusHref ? (
            <Link
              href={statusHref}
              className="focus-ring mt-4 inline-flex items-center gap-1 text-sm font-semibold text-coral hover:underline"
            >
              {tPortal("completedStatusCta")} <ArrowRight size={13} aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          {/* The focal point of a live call. Mounted for the whole span (not only
              while live) so the candidate has one thing that is always saying
              something true — connecting, listening, thinking, speaking, ended. */}
          {phase !== "idle" || turns.length > 0 ? (
            <InterviewPresence state={presence} levels={levelsRef} className="py-2" />
          ) : null}

          {/* H5: a live call that ended with zero captured turns almost always means the mic was
              muted or produced no audio — explain the silent dead-end instead of just re-showing
              the Start controls with an empty transcript. Skipped when another error (e.g. a
              dropped connection) already explains the failure. */}
          {phase === "ended" && endedAs === "failed" && turns.length === 0 && !error ? (
            <div role="status" className="rounded-lg border border-coral/30 bg-coral/5 px-5 py-6 text-center">
              <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-coral/10 text-coral">
                <MicOff size={20} aria-hidden />
              </span>
              <h2 className="mt-3 font-serif text-h2 text-ink">{t("noAudioTitle")}</h2>
              <p className="mx-auto mt-1.5 max-w-md text-base leading-6 text-steel">{t("noAudioBody")}</p>
            </div>
          ) : null}

          {/* H5 follow-up: pre-call mic test — reassurance + early catch of a muted/dead mic.
              It now carries the speaker check too: a candidate who cannot HEAR the
              interviewer fails the screen exactly as completely as one we cannot hear. */}
          {!isBusy ? (
            <MicTestPanel
              micTest={micTest}
              micLevel={micLevel}
              onTest={testMic}
              speakerTest={speakerTest}
              onSpeakerTest={playTone}
              onSpeakerHeard={confirmHeard}
            />
          ) : null}

          {/* A RESUMED attempt: say so. The transcript above already carries the
              earlier turns, so without this line the candidate is looking at words
              they do not remember this call saying. */}
          {resumedTurns > 0 && phase !== "ended" ? (
            <p role="status" className="rounded-md border border-moss/30 bg-moss/5 px-3 py-2 text-base text-ink">
              {t("resume.continuing")}
            </p>
          ) : null}

          {/* Consent */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 text-base text-ink transition-colors ${
              consent ? "border-moss/40 bg-moss/5" : "border-stone-200 bg-paper/50"
            } ${isBusy ? "cursor-default" : ""}`}
          >
            <input
              type="checkbox"
              checked={consent}
              disabled={isBusy}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded text-moss focus-ring"
            />
            <span className="leading-6">
              {/* The main consent must stay TRUE. Its standing line ends "No audio
                  is stored", which is a promise this deployment only keeps when the
                  workspace does not offer recording — so where recording IS on
                  offer, the recordable variant says so and points at the separate
                  tick below. Two keys, one choice, made from the server's own
                  answer about this workspace. */}
              {t.rich(recordingOffered === true ? "consentRecordable" : "consent", {
                b: (chunks) => <span className="font-medium">{chunks}</span>,
              })}
            </span>
          </label>

          {/* The SEPARATE, opt-in recording consent, directly under the main one so
              the two are read together and told apart. Declining never blocks the
              call, and a workspace that does not offer recording renders nothing.
              WP3 owns the checkbox's own copy and what it then does. */}
          <RecordingConsent
            offered={recordingOffered === true}
            checked={recordingConsent}
            disabled={isBusy}
            onChange={setRecordingConsent}
          />

          {/* Controls */}
          <div
            className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-paper/50 px-4 py-3"
            // Busy for the whole connecting→live→ending span (not just connecting), so
            // the wrap-up phase is also announced as busy.
            aria-busy={isBusy}
          >
            {!liveOrEnding ? (
              <button
                type="button"
                onClick={start}
                disabled={!consent || phase === "connecting" || !providerAvailable}
                className={`${BTN_PRIMARY_LG} gap-2 disabled:cursor-not-allowed`}
              >
                <Mic size={18} />
                {phase === "connecting" ? t("connecting") : phase === "ended" ? t("startAgain") : t("startCall")}
              </button>
            ) : phase === "ending" ? (
              <button
                type="button"
                disabled
                className={`${BTN_PRIMARY_LG} gap-2 opacity-50`}
              >
                <PhoneOff size={18} />
                {t("ending")}
              </button>
            ) : confirmingEnd ? (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("endConfirm")}>
                <span className="text-base text-ink">{t("endConfirm")}</span>
                <button
                  type="button"
                  // Named, not bare `end`: the handler takes the ending KIND, and
                  // `onClick={end}` would hand it a click event instead.
                  onClick={() => void end("candidate_end")}
                  className={`${BTN_PRIMARY_LG} gap-2`}
                >
                  <PhoneOff size={18} />
                  {t("endConfirmYes")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingEnd(false)}
                  className={`${BTN_SECONDARY_LG} font-semibold`}
                >
                  {t("endConfirmNo")}
                </button>
              </div>
            ) : (
              <button
                ref={endBtnRef}
                type="button"
                onClick={() => setConfirmingEnd(true)}
                className={`${BTN_PRIMARY_LG} gap-2`}
              >
                <PhoneOff size={18} />
                {t("endCall")}
              </button>
            )}
            <StatusPill
              phase={phase}
              speaking={interviewerSpeaking}
              // The model is generating but silent — the one stretch of a call with
              // no cue at all before this.
              thinking={thinking}
              // bug-ui-scan-2026-07-09 (voice-interview #3): degraded-connection cue.
              unstable={unstable}
            />
            {/* M4: mute for a "give me a moment"; M3: elapsed timer for orientation — both live-only.
                bug-ui-scan-2026-07-09 (voice-interview #4) adds the AI-output mute and the
                autoplay-blocked recovery to the same live-only group. */}
            {/* The one in-call surface recording gets: a quiet chip, only while
                audio is actually being kept. The hook answers "off" whenever the
                workspace does not offer it or the candidate declined, so this is
                nothing to reason about at the call site. */}
            {phase === "live" ? <RecordingIndicator state={recordingState} /> : null}
            {phase === "live" ? (
              <VoiceLiveControls
                muted={muted}
                onToggleMute={toggleMute}
                audioMuted={audioMuted}
                onToggleAudioMuted={toggleAudioMuted}
                elapsed={elapsed}
                durationMin={durationMin}
                unstable={unstable}
                audioBlocked={audioBlocked}
                onEnableAudio={enableAudio}
              />
            ) : null}
            {startGate === "unavailable" ? (
              // M5: candidates can't fix "keys not configured" (an ops issue) and shouldn't see the
              // internal phrasing — give them an actionable next step. The lab keeps the technical copy.
              <span className="text-meta text-coral">
                {lockSettings
                  ? t("unavailableCandidate")
                  : t("keysNotConfigured", { provider: PROVIDER_LABEL[liveProvider] })}
              </span>
            ) : startGate === "unknown" ? (
              // The probe FAILED — we do not know whether the call can connect, and
              // saying nothing while showing a live Start was the lie this replaces.
              // Say so, and offer the only useful action: ask again.
              <span className="text-meta text-coral" role="status">
                {t("availabilityUnknown")}{" "}
                <button type="button" onClick={recheckAvailability} className="focus-ring font-semibold underline">
                  {t("availabilityRetry")}
                </button>
              </span>
            ) : null}
          </div>
        </>
      )}

      {error ? (
        <p role="alert" className="rounded-md border border-coral/30 bg-coral/5 px-3 py-2 text-base text-coral">
          {error}
        </p>
      ) : null}

      {/* The completion was REFUSED, not dropped: another window's call on this same
          link finished first and this transcript is not in the record. No Retry —
          it would be refused identically — just the truth, which the old
          `{ok:true, alreadyCompleted:true}` reply made impossible to tell. */}
      {discardedTurns > 0 ? (
        <p
          role="alert"
          className="rounded-md border border-coral/30 bg-coral/5 px-3 py-2 text-base text-coral"
        >
          {t("discardedTurns", { count: discardedTurns })}
        </p>
      ) : null}

      {/* M6: save-failure recovery — a real action (Retry saving), not just "keep this tab open". */}
      {saveFailed && discardedTurns === 0 ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-coral/30 bg-coral/5 px-3 py-2.5 text-base text-coral"
        >
          <span>{t("saveFailed")}</span>
          <button
            type="button"
            onClick={() => void retrySave()}
            className="focus-ring rounded-md border border-coral/40 bg-white px-3 py-1 text-meta font-semibold text-coral transition-colors hover:bg-coral/10"
          >
            {t("retrySave")}
          </button>
        </div>
      ) : null}

      {/* Transcript */}
      <VoiceTranscript
        turns={turns}
        phase={phase}
        awaitingMic={awaitingMic}
        candidateLabel={candidateLabel}
        jobTitle={jobTitle}
        // The interviewer's line AS IT IS SPOKEN. It is provisional by
        // construction — the turn still finalizes on the provider's `.done` — so it
        // renders outside the `role="log"` list and is never persisted.
        interviewerPartial={interviewerPartial}
        // Earlier attempts' turns are already in `turns`; the log says where the
        // seam is rather than pretending this call said all of it.
        resumedTurns={resumedTurns}
      />
    </div>
  );
}
