"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider } from "@elevenlabs/react";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, Mic, MicOff, PhoneOff } from "lucide-react";
import { useErrorMessage } from "@/app/_lib/use-error-message";
// Provider id, transcript turn, and availability map are single-sourced in the
// voice adapter layer. Import from voice/types (not the package index, which
// pulls the server-only adapters into the bundle); these are type-only, so the
// import is erased at compile time.
import type { VoiceAvailability, VoiceProviderId, VoiceTurn } from "@/app/_lib/voice/types";
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
import { collectVoicePreflightEnv, voicePreflightError } from "@/app/_lib/voice/preflight";
// The two realtime transports live side by side under transport/: OpenAI Realtime
// is raw WebRTC (a plain module of ref-driven functions), ElevenLabs is a thin hook
// around the SDK. Everything provider-specific — protocol buffers, teardown order,
// the drop debounce, the agent overrides — moved with them; what stays here is the
// shell they share: phase, consent, the transcript, and finalize().
import {
  startOpenAiCall,
  teardownOpenAi as teardownOaiTransport,
  type OaiRefs,
} from "./transport/openai";
import { startElevenLabsSession, useElevenLabsTransport } from "./transport/elevenlabs";
import { useMicTest } from "./useMicTest";
import { useTranscriptPersistence } from "./useTranscriptPersistence";
import { micErrorText } from "./micErrorText";
import { PROVIDER_LABEL, type LangHint, type Phase } from "./ui-types";
import { MicTestPanel } from "./MicTestPanel";
import { StatusPill } from "./VoiceStatusPill";
import { VoiceLiveControls } from "./VoiceLiveControls";
import { VoiceSettings } from "./VoiceSettings";
import { VoiceTranscript } from "./VoiceTranscript";

// Live voice-interview MVP. OpenAI Realtime runs over raw WebRTC; ElevenLabs
// runs through the @elevenlabs/react SDK. A switcher lets you A/B both on the
// same short script. The server (/api/interview/connect) mints short-lived
// creds so no API key reaches the browser; the transcript is POSTed to
// /api/interview/complete on hang-up.

export type VoiceInterviewProps = {
  token?: string;
  candidateLabel?: string;
  jobTitle?: string;
  // Candidate-portal mode (idea voice-3): pin the provider to the recruiter's
  // per-session choice and hide the provider/language picker, so a candidate can't
  // override the grounded provider the session was created for. The lab passes
  // neither and keeps the full A/B picker.
  provider?: VoiceProviderId;
  lockSettings?: boolean;
};

// How long finalize() waits for a candidate utterance whose transcription is
// still in flight when the call ends (idea-b70b8bd7). Whisper turnaround for a
// short closing answer is well under this; past it we fall back to whatever
// streamed into the delta buffer rather than hanging the "Ending…" state. Held
// at 3s — the same bound as EL_DISCONNECT_GRACE_MS — so both provider paths give
// the candidate's closing answer the same headroom to land before finalize
// snapshots the transcript that feeds the scorecard (the rescue is still
// single-finalize: finalizedRef latches before the wait).
const OAI_FINAL_TURN_GRACE_MS = 3000;

// How long end() waits for ElevenLabs onDisconnect to drive finalize() before
// finalizing itself. The SDK delivers the candidate's final utterance via
// onMessage a few hundred ms AFTER endSession(), then closes (onDisconnect), so
// deferring to onDisconnect captures that closing turn; the timer is the fallback
// if onDisconnect never lands.
const EL_DISCONNECT_GRACE_MS = 3000;

/** Poll `done` every 100ms until it holds or `timeoutMs` elapses. */
async function waitUntil(done: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!done() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
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

function VoiceInterviewInner({ token, candidateLabel, jobTitle, provider: pinnedProvider, lockSettings }: VoiceInterviewProps) {
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
  const [availability, setAvailability] = useState<VoiceAvailability | null>(null);
  // In locked (candidate) mode the provider is pinned to the session's stored value;
  // the lab starts on the default and lets the user pick.
  const [provider, setProvider] = useState<VoiceProviderId>(pinnedProvider ?? DEFAULT_PROVIDER);
  const [consent, setConsent] = useState(false);
  // The language picker is hidden on the candidate portal (lockSettings), so seed
  // the spoken-agent language hint from the candidate's UI locale — the agent then
  // speaks Czech for a cs visitor instead of falling to "auto". The lab keeps the
  // explicit "auto" default + the visible picker.
  const [language, setLanguage] = useState<LangHint>(
    lockSettings ? (locale === "cs" ? "cs" : "en") : "auto"
  );
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
  // H3: whether the assistant audio is currently active (OpenAI path — see the AnalyserNode).
  const [oaiSpeaking, setOaiSpeaking] = useState(false);
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

  // H5 follow-up: the pre-call mic test lives in its own hook — it shares nothing with
  // the call but the device, hence the two touchpoints (resetForCall / stopMicTest).
  const { micTest, micLevel, testMic, stopMicTest, resetForCall: resetMicTestForCall } = useMicTest();

  // Refs avoid stale closures inside provider callbacks / teardown.
  const sessionIdRef = useRef<string | null>(null);
  // /complete demands the session token as the completion capability
  // (idea-5248c3e9). The portal/sim pages pass it as a prop; a lab session
  // receives it from /connect when the session is created.
  const sessionTokenRef = useRef<string | null>(null);
  const providerRef = useRef<VoiceProviderId>(provider);
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
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // M7: focus targets so keyboard/SR users aren't stranded when controls are swapped on a phase change.
  const endBtnRef = useRef<HTMLButtonElement | null>(null);
  const endedCardRef = useRef<HTMLDivElement | null>(null);

  // Keep a ref of the active provider for use inside SDK callbacks/teardown.
  useEffect(() => {
    providerRef.current = provider;
  }, [provider]);

  const clearConnectTimer = useCallback(() => {
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
  }, []);

  const pushTurn = useCallback((role: VoiceTurn["role"], text: string) => {
    const t = (text ?? "").trim();
    if (!t) return;
    const turn: VoiceTurn = { role, text: t, at: new Date().toISOString() };
    turnsRef.current = [...turnsRef.current, turn];
    setTurns(turnsRef.current);
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
    }),
    []
  );

  const teardownOpenAi = useCallback(() => {
    teardownOaiTransport(oaiRefs(), {
      setSpeaking: setOaiSpeaking,
      setUnstable,
      setAudioBlocked,
    });
  }, [oaiRefs]);

  const { saveFailed, setSaveFailed, persistTranscript, retrySave } = useTranscriptPersistence({
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
      // silently dropped from the transcript that feeds the scorecard. When an
      // utterance is pending at hang-up, stop capture (so server VAD sees
      // end-of-speech and transcribes what it heard) but keep the data channel
      // open briefly to receive it.
      if (
        status === "completed" &&
        providerRef.current === "openai" &&
        pendingCandidateRef.current &&
        dcRef.current?.readyState === "open"
      ) {
        micRef.current?.getTracks().forEach((tr) => tr.stop());
        await waitUntil(() => !pendingCandidateRef.current, OAI_FINAL_TURN_GRACE_MS);
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
        console.warn(
          `[voice] final candidate turn lost: transcription grace (${OAI_FINAL_TURN_GRACE_MS}ms) expired with an empty delta buffer — the closing answer is missing from the scored transcript (use a streaming OPENAI_REALTIME_TRANSCRIPTION_MODEL to populate the fallback).`
        );
      }
      pushTurn("candidate", candBuf.current);
      candBuf.current = "";
      pendingCandidateRef.current = false;
      teardownOpenAi();
      setPhase("ended");
      setEndedAs(status);
      // bug-ui-scan-2026-07-09 (voice-interview #2): a substantive call that ended on
      // a late transport blip still finalizes "completed" (interviewFinalStatus) and
      // WILL be scored — clear the transient connection error (set by onError / the
      // OpenAI drop) so the success closing card isn't contradicted by a red banner.
      if (status === "completed") setError(null);
      const sid = sessionIdRef.current;
      const tok = sessionTokenRef.current ?? token ?? null;
      if (sid && tok) {
        const saved = await persistTranscript(tok, sid, turnsRef.current, status);
        if (!saved) setSaveFailed(true);
      }
    },
    [teardownOpenAi, clearConnectTimer, pushTurn, persistTranscript, setSaveFailed, token]
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

  // M4: mute/unmute the candidate's microphone for a "give me a moment" without ending the call.
  function toggleMute() {
    const next = !muted;
    setMuted(next);
    if (providerRef.current === "elevenlabs") {
      try {
        conversation.setMuted(next);
      } catch {
        /* SDK not ready — state still reflects intent */
      }
    } else {
      micRef.current?.getAudioTracks().forEach((tr) => (tr.enabled = !next));
    }
  }

  // bug-ui-scan-2026-07-09 (voice-interview #4): mute/unmute the AI's OUTPUT voice —
  // the load-bearing channel of a voice interview — which previously had no control
  // at all (only the candidate mic was muteable). OpenAI plays through the hidden
  // <audio> element; ElevenLabs renders internally, so route through the SDK volume.
  function toggleAudioMuted() {
    const next = !audioMuted;
    setAudioMuted(next);
    if (providerRef.current === "elevenlabs") {
      try {
        conversation.setVolume({ volume: next ? 0 : 1 });
      } catch {
        /* SDK not ready — state still reflects intent */
      }
    } else if (audioRef.current) {
      audioRef.current.muted = next;
    }
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
  const currentFinalStatus = () =>
    interviewFinalStatus({
      errored: erroredRef.current,
      reachedLive: reachedLiveRef.current,
      turnCount: turnsRef.current.length,
      candidateTurnCount: turnsRef.current.filter((t) => t.role === "candidate").length,
    });

  const conversation = useElevenLabsTransport({
    isFinalized: () => finalizedRef.current,
    isActiveProvider: () => providerRef.current === "elevenlabs",
    onConnected: () => {
      clearConnectTimer();
      reachedLiveRef.current = true;
      setPhase("live");
    },
    onClosed: () => void finalize(currentFinalStatus()),
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
      setError(micErrorText(cause ?? message, micCopy) ?? (message || t("errVoiceSession")));
      setPhase("error");
    },
    pushTurn,
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/interview/connect")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const avail: VoiceAvailability | null = d.availability ?? null;
        setAvailability(avail);
        // Never leave the picker on a provider whose keys are missing: if the
        // default (ElevenLabs) isn't configured, drop to the first one that is.
        // Skip in locked (candidate) mode — the recruiter's pinned provider must
        // stand; an unconfigured one surfaces "keys not configured" rather than
        // silently switching the candidate onto a different, ungrounded provider.
        if (avail && !lockSettings) setProvider((cur) => (avail[cur] ? cur : (PROVIDER_ORDER.find((p) => avail[p]) ?? cur)));
      })
      .catch(() => {
        if (!cancelled) setAvailability(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Teardown on unmount.
  useEffect(() => {
    return () => {
      if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
      try {
        if (providerRef.current === "elevenlabs") conversation.endSession();
      } catch {
        /* noop */
      }
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
            const status = unmountBeaconStatus(endInFlightRef.current, {
              errored: erroredRef.current,
              reachedLive: reachedLiveRef.current,
              turnCount: turnsRef.current.length,
              candidateTurnCount: turnsRef.current.filter((t) => t.role === "candidate").length,
            });
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // H4: a mid-call network drop on the raw-WebRTC OpenAI path (no onDisconnect like ElevenLabs)
  // otherwise froze the call "live" forever with a hot mic. Save what we have and surface a
  // reconnectable error instead of hanging.
  function handleOaiDrop() {
    if (finalizedRef.current || !reachedLiveRef.current) return;
    erroredRef.current = true;
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
    setMuted(false);
    setElapsed(0);
    resetMicTestForCall(); // release the test mic before the real call claims the device
    // Pre-flight BEFORE dialing (idea-b0fc8018): an in-app webview, a plain-HTTP
    // link, or a WebRTC-less browser is the most common real-world failure of a
    // first-round screen — name the root cause and the fix, and never burn a
    // /connect call (which mints provider credentials) on a doomed environment.
    const preflight = voicePreflightError(collectVoicePreflightEnv(), provider);
    if (preflight) {
      setError(preflight);
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
    // Clear the prior call's session capability ids too: a re-connect that fails
    // before /connect returns fresh ones must not let finalize POST against the
    // previous (already-completed) session.
    sessionIdRef.current = null;
    sessionTokenRef.current = null;
    setPhase("connecting");
    // Never hang on "Connecting…": if we aren't live within 30s, surface an error.
    clearConnectTimer();
    connectTimerRef.current = setTimeout(() => {
      finalizedRef.current = true; // don't POST a transcript for a failed connect
      teardownOpenAi();
      try {
        conversation.endSession();
      } catch {
        /* noop */
      }
      setError(t("errConnectTimeout"));
      setPhase("error");
    }, 30000);
    try {
      const res = await fetch("/api/interview/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          token,
          consent,
          language: language === "auto" ? undefined : language,
        }),
      });
      const data = await res.json();
      // /api/interview/connect answers with safeJsonError's `{ error, code }`
      // (INTERVIEW_CONNECT_FAILED) — resolve the code; `error` is English for the
      // server log (app/_lib/use-error-message.ts). The old fallback was a raw
      // English `connect failed (status)` string, so every locale saw English twice.
      if (!res.ok) throw new Error(errMsg(data, t("errStartCall")));
      sessionIdRef.current = data.sessionId;
      sessionTokenRef.current = (typeof data.token === "string" ? data.token : null) ?? token ?? null;
      const c = data.connect;
      // The server may have FAILED OVER to the other provider (the preferred one's
      // connect threw and the alternate was available). connect.provider is
      // authoritative: pin our path + teardown/finalize branching (providerRef) to
      // what actually served, not what we requested, before starting the session.
      if (c?.provider && c.provider !== providerRef.current) {
        providerRef.current = c.provider;
        setProvider(c.provider);
      }
      if (c.provider === "openai") {
        await startOpenAiCall(c, {
          refs: oaiRefs(),
          finalizedRef,
          reachedLiveRef,
          pushTurn,
          setSpeaking: setOaiSpeaking,
          setUnstable,
          setAudioBlocked,
          setAwaitingMic,
          setLive: () => setPhase("live"),
          clearConnectTimer,
          onDrop: handleOaiDrop,
        });
      } else {
        startElevenLabsSession({
          conversation,
          signedUrl: c.signedUrl,
          agentPrompt: data.agentPrompt ?? undefined,
          asrKeywords: Array.isArray(data.asrKeywords) ? data.asrKeywords : undefined,
          language,
          onAsyncError: (err) => {
            clearConnectTimer();
            setError(micErrorText(err, micCopy) ?? (err instanceof Error ? err.message : t("errElevenConnect")));
            setPhase("error");
          },
        });
      }
    } catch (e) {
      clearConnectTimer();
      setError(micErrorText(e, micCopy) ?? (e instanceof Error ? e.message : t("errStartCall")));
      setPhase("error");
      teardownOpenAi();
    }
  }

  async function end() {
    setPhase("ending");
    // bug-ui-scan-2026-07-09 (voice-interview #5): mark a clean End in flight so an
    // unmount that races ahead of ElevenLabs onDisconnect beacons the REAL verdict
    // (completed for a substantive call) instead of a hardcoded "failed".
    endInFlightRef.current = true;
    if (providerRef.current === "elevenlabs") {
      // Defer finalize to onDisconnect so the candidate's final answer — delivered
      // by the SDK via onMessage a few hundred ms AFTER endSession() — is captured
      // before turnsRef is snapshotted. Synchronously finalizing here latched
      // finalizedRef first and dropped that closing turn. The timer is a fallback
      // for a missing onDisconnect.
      try {
        conversation.endSession();
      } catch {
        /* noop */
      }
      window.setTimeout(() => {
        if (!finalizedRef.current) {
          void finalize(currentFinalStatus());
        }
      }, EL_DISCONNECT_GRACE_MS);
      return;
    }
    // OpenAI branch: mirror ElevenLabs — derive completed-vs-failed from the same signals
    // instead of hardcoding "completed". A zero-turn hang-up (silent mic, transcription
    // failure, mistaken early End) previously locked the session terminal-completed, so the
    // candidate was permanently shut out of their own link; interviewFinalStatus returns
    // "failed" for turnCount 0, keeping it reconnectable just like the EL path.
    await finalize(currentFinalStatus());
  }

  const isBusy = phase === "connecting" || phase === "live" || phase === "ending";
  const liveProvider = provider;
  const providerAvailable = availability ? availability[liveProvider] : true;

  const liveOrEnding = phase === "live" || phase === "ending";

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
          availability={availability}
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
        </div>
      ) : (
        <>
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

          {/* H5 follow-up: pre-call mic test — reassurance + early catch of a muted/dead mic. */}
          {!isBusy ? <MicTestPanel micTest={micTest} micLevel={micLevel} onTest={testMic} /> : null}

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
              {t.rich("consent", { b: (chunks) => <span className="font-medium">{chunks}</span> })}
            </span>
          </label>

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
                className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-md bg-ink px-5 text-base font-semibold text-white transition-colors hover:bg-steel disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Mic size={18} />
                {phase === "connecting" ? t("connecting") : phase === "ended" ? t("startAgain") : t("startCall")}
              </button>
            ) : phase === "ending" ? (
              <button
                type="button"
                disabled
                className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-md bg-coral px-5 text-base font-semibold text-white opacity-50"
              >
                <PhoneOff size={18} />
                {t("ending")}
              </button>
            ) : confirmingEnd ? (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("endConfirm")}>
                <span className="text-base text-ink">{t("endConfirm")}</span>
                <button
                  type="button"
                  onClick={end}
                  className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-md bg-coral px-5 text-base font-semibold text-white transition-opacity hover:opacity-90"
                >
                  <PhoneOff size={18} />
                  {t("endConfirmYes")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingEnd(false)}
                  className="focus-ring inline-flex h-11 items-center justify-center rounded-md border border-stone-300 bg-white px-5 text-base font-semibold text-ink transition-colors hover:bg-paper"
                >
                  {t("endConfirmNo")}
                </button>
              </div>
            ) : (
              <button
                ref={endBtnRef}
                type="button"
                onClick={() => setConfirmingEnd(true)}
                className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-md bg-coral px-5 text-base font-semibold text-white transition-opacity hover:opacity-90"
              >
                <PhoneOff size={18} />
                {t("endCall")}
              </button>
            )}
            <StatusPill
              phase={phase}
              speaking={liveProvider === "elevenlabs" ? conversation.isSpeaking : oaiSpeaking}
              // bug-ui-scan-2026-07-09 (voice-interview #3): degraded-connection cue.
              unstable={unstable}
            />
            {/* M4: mute for a "give me a moment"; M3: elapsed timer for orientation — both live-only.
                bug-ui-scan-2026-07-09 (voice-interview #4) adds the AI-output mute and the
                autoplay-blocked recovery to the same live-only group. */}
            {phase === "live" ? (
              <VoiceLiveControls
                muted={muted}
                onToggleMute={toggleMute}
                audioMuted={audioMuted}
                onToggleAudioMuted={toggleAudioMuted}
                elapsed={elapsed}
                unstable={unstable}
                audioBlocked={audioBlocked}
                onEnableAudio={enableAudio}
              />
            ) : null}
            {!providerAvailable ? (
              // M5: candidates can't fix "keys not configured" (an ops issue) and shouldn't see the
              // internal phrasing — give them an actionable next step. The lab keeps the technical copy.
              <span className="text-meta text-coral">
                {lockSettings
                  ? t("unavailableCandidate")
                  : t("keysNotConfigured", { provider: PROVIDER_LABEL[liveProvider] })}
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

      {/* M6: save-failure recovery — a real action (Retry saving), not just "keep this tab open". */}
      {saveFailed ? (
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
      />
    </div>
  );
}
