"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, Clock, Mic, MicOff, PhoneOff, Sparkles, User, Volume2, VolumeX } from "lucide-react";
import { parseOaiTranscriptEvent } from "@/app/_lib/voice/openai";
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

// Live voice-interview MVP. OpenAI Realtime runs over raw WebRTC; ElevenLabs
// runs through the @elevenlabs/react SDK. A switcher lets you A/B both on the
// same short script. The server (/api/interview/connect) mints short-lived
// creds so no API key reaches the browser; the transcript is POSTed to
// /api/interview/complete on hang-up.

type Phase = "idle" | "connecting" | "live" | "ending" | "ended" | "error";
type LangHint = "auto" | "cs" | "en";

const PROVIDER_LABEL: Record<VoiceProviderId, string> = { openai: "OpenAI Realtime", elevenlabs: "ElevenLabs Agents" };

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
// streamed into the delta buffer rather than hanging the "Ending…" state.
const OAI_FINAL_TURN_GRACE_MS = 2000;

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
  // The completed closing card reuses the SAME strings the portal page renders
  // server-side for an already-completed link (app/interview/[token]/page.tsx),
  // so the candidate sees one consistent ending whether they finish live or
  // reload — they live one namespace up from this component's "interview.voice".
  const tPortal = useTranslations("interview");
  const locale = useLocale();
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
  // M6: the transcript POST failed after retries — surface a manual Retry (the body is stashed in
  // sessionStorage) instead of asking the candidate to babysit a tab with no action to take.
  const [saveFailed, setSaveFailed] = useState(false);
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
  // H5 follow-up: a pre-call mic test — confirm "we can hear you" before dialing, so a muted/dead
  // mic is caught early (and a nervous candidate is reassured) rather than surfacing as a silent
  // dead-end mid-call.
  const [micTest, setMicTest] = useState<"idle" | "testing" | "heard" | "silent" | "denied">("idle");
  const [micLevel, setMicLevel] = useState(0);
  const [turns, setTurns] = useState<VoiceTurn[]>([]);

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
  const logRef = useRef<HTMLDivElement | null>(null);
  // M7: focus targets so keyboard/SR users aren't stranded when controls are swapped on a phase change.
  const endBtnRef = useRef<HTMLButtonElement | null>(null);
  const endedCardRef = useRef<HTMLDivElement | null>(null);
  // H5 follow-up: the pre-call mic-test stream / analyser, torn down when the test finishes.
  const micTestStreamRef = useRef<MediaStream | null>(null);
  const micTestCtxRef = useRef<AudioContext | null>(null);
  const micTestRafRef = useRef<number | null>(null);

  // Keep a ref of the active provider for use inside SDK callbacks/teardown.
  useEffect(() => {
    providerRef.current = provider;
  }, [provider]);

  // Pin the live transcript to the newest turn so the candidate always sees the
  // latest exchange without scrolling. Runs on every turn append.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

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

  const teardownOpenAi = useCallback(() => {
    try {
      dcRef.current?.close();
    } catch {
      /* noop */
    }
    try {
      pcRef.current?.getSenders().forEach((s) => s.track?.stop());
      pcRef.current?.close();
    } catch {
      /* noop */
    }
    micRef.current?.getTracks().forEach((tr) => tr.stop());
    // Tear down the H3 speaking-meter analyser and the H4 drop timer.
    if (oaiRafRef.current != null) cancelAnimationFrame(oaiRafRef.current);
    oaiRafRef.current = null;
    try {
      void oaiAudioCtxRef.current?.close();
    } catch {
      /* noop */
    }
    oaiAudioCtxRef.current = null;
    if (dropTimerRef.current) clearTimeout(dropTimerRef.current);
    dropTimerRef.current = null;
    setOaiSpeaking(false);
    // bug-ui-scan-2026-07-09 (voice-interview #3, #4): the degraded-connection and
    // blocked-audio cues are meaningless once the connection is gone — clear them
    // so a closing/error card never shows a stale "reconnecting"/"tap to enable".
    setUnstable(false);
    setAudioBlocked(false);
    pcRef.current = null;
    dcRef.current = null;
    micRef.current = null;
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      // bug-ui-scan-2026-07-09 (voice-interview #4): the <audio> element persists
      // across calls (single ref) — clear the output mute so a retry never inherits
      // a stale muted state while the button reads "unmuted".
      audioRef.current.muted = false;
    }
  }, []);

  // Durable persist of the transcript — the ONLY record of the interview. Stash it
  // locally first (so a total POST failure doesn't vanish it), then POST with a
  // few retries; 4xx (consent/token/already-completed) won't improve on retry, so
  // stop. keepalive lets it survive a closing tab. Returns whether it was saved.
  const persistTranscript = useCallback(
    async (tok: string, sid: string, transcript: VoiceTurn[], status: "completed" | "failed"): Promise<boolean> => {
      const body = JSON.stringify({ token: tok, sessionId: sid, transcript, status });
      const stashKey = `kp.iv.${sid}`;
      try {
        sessionStorage.setItem(stashKey, body);
      } catch {
        /* ignore */
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const res = await fetch("/api/interview/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive: true,
          });
          if (res.ok) {
            try {
              sessionStorage.removeItem(stashKey);
            } catch {
              /* ignore */
            }
            return true;
          }
          if (res.status >= 400 && res.status < 500) break;
        } catch {
          /* network error — retry */
        }
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
      return false;
    },
    []
  );

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
    [teardownOpenAi, clearConnectTimer, pushTurn, persistTranscript, token]
  );

  // M6: re-POST the (still in-memory + sessionStorage-stashed) transcript on demand or when the
  // tab regains connectivity/visibility, so a transient network failure doesn't lose the record.
  const retrySave = useCallback(async () => {
    const sid = sessionIdRef.current;
    const tok = sessionTokenRef.current ?? token ?? null;
    if (!sid || !tok) return;
    const saved = await persistTranscript(tok, sid, turnsRef.current, endedAs ?? "failed");
    if (saved) setSaveFailed(false);
  }, [persistTranscript, token, endedAs]);

  useEffect(() => {
    if (!saveFailed) return;
    const onRetry = () => {
      if (navigator.onLine) void retrySave();
    };
    window.addEventListener("online", onRetry);
    document.addEventListener("visibilitychange", onRetry);
    return () => {
      window.removeEventListener("online", onRetry);
      document.removeEventListener("visibilitychange", onRetry);
    };
  }, [saveFailed, retrySave]);

  // M3: tick the elapsed timer while live so a nervous candidate can orient (am I 3 or 18 min in?).
  useEffect(() => {
    if (phase !== "live") return;
    const started = Date.now();
    setElapsed(0);
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
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

  // H5 follow-up: release the pre-call mic-test stream + analyser (called when the test ends, on a
  // real call start, and on unmount).
  function stopMicTest() {
    if (micTestRafRef.current != null) cancelAnimationFrame(micTestRafRef.current);
    micTestRafRef.current = null;
    micTestStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    micTestStreamRef.current = null;
    try {
      void micTestCtxRef.current?.close();
    } catch {
      /* noop */
    }
    micTestCtxRef.current = null;
  }

  // H5 follow-up: sample the mic for ~4s and report whether we heard anything, with a live level bar.
  async function testMic() {
    stopMicTest();
    setMicTest("testing");
    setMicLevel(0);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setMicTest("denied");
      return;
    }
    micTestStreamRef.current = stream;
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) {
        setMicTest("heard"); // can't measure — assume ok rather than block the candidate
        stopMicTest();
        return;
      }
      const ctx = new Ctx();
      micTestCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const started = Date.now();
      let peak = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        peak = Math.max(peak, rms);
        setMicLevel(Math.min(1, rms * 4));
        if (Date.now() - started < 4000) {
          micTestRafRef.current = requestAnimationFrame(tick);
        } else {
          setMicTest(peak > 0.03 ? "heard" : "silent");
          setMicLevel(0);
          stopMicTest();
        }
      };
      micTestRafRef.current = requestAnimationFrame(tick);
    } catch {
      setMicTest("heard");
      stopMicTest();
    }
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
    });

  const conversation = useConversation({
    onConnect: () => {
      // A late onConnect after the 30s connect timeout (which latched finalizedRef
      // and tore down) must NOT flip to "live": the candidate would talk into a
      // call whose transcript can never be POSTed. Abandon it instead.
      if (finalizedRef.current) {
        try {
          conversation.endSession();
        } catch {
          /* noop */
        }
        return;
      }
      clearConnectTimer();
      reachedLiveRef.current = true;
      setPhase("live");
    },
    onDisconnect: () => {
      // ElevenLabs fires this on every socket close, including the one that
      // follows onError. Finalize as "completed" ONLY when the call actually
      // held a real conversation; an error blip or a never-live connect becomes
      // "failed" so /api/interview/complete skips scoring (and never sets the
      // Interview→Offer approval) and the candidate can retry the link.
      if (providerRef.current !== "elevenlabs") return;
      void finalize(currentFinalStatus());
    },
    onError: (message: string) => {
      clearConnectTimer();
      erroredRef.current = true;
      setError(message || t("errVoiceSession"));
      setPhase("error");
    },
    onMessage: ({ message, source }: { message: string; source: "user" | "ai" }) =>
      pushTurn(source === "user" ? "candidate" : "interviewer", message),
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

  function handleOaiEvent(ev: Record<string, unknown>) {
    // The realtime wire protocol (event-type strings + payload shape) is parsed
    // in voice/openai.ts; here we only apply the resulting transcript action.
    const parsed = parseOaiTranscriptEvent(ev);
    if (!parsed) return;
    if (parsed.kind === "candidateSpeechStarted") {
      pendingCandidateRef.current = true;
    } else if (parsed.kind === "candidateDelta") {
      candBuf.current += parsed.text;
    } else if (parsed.kind === "candidateUtterance") {
      pendingCandidateRef.current = false;
      candBuf.current = "";
      pushTurn("candidate", parsed.text);
    } else if (parsed.kind === "assistantDelta") {
      asstBuf.current += parsed.text;
    } else if (parsed.kind === "assistantDone") {
      pushTurn("interviewer", asstBuf.current);
      asstBuf.current = "";
    }
  }

  // H3: drive the "AI speaking" indicator from the OpenAI remote audio level (the raw-WebRTC path
  // has no isSpeaking like the ElevenLabs SDK). Best-effort — any failure just leaves the pill on
  // its default, and the CSS animation is already reduced-motion gated.
  function startOaiSpeakingMeter(stream: MediaStream) {
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      oaiAudioCtxRef.current = ctx;
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
        setOaiSpeaking(Math.sqrt(sum / data.length) > 0.02);
        oaiRafRef.current = requestAnimationFrame(tick);
      };
      oaiRafRef.current = requestAnimationFrame(tick);
    } catch {
      /* analyser is enhancement only */
    }
  }

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

  async function startOpenAi(c: { model: string; clientSecret: string; callsUrl: string }) {
    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    pc.ontrack = (e) => {
      const el = audioRef.current;
      if (el) {
        el.srcObject = e.streams[0];
        // bug-ui-scan-2026-07-09 (voice-interview #4): the interviewer's voice is the
        // load-bearing channel. `autoPlay` fails SILENTLY on strict-mobile / low-power
        // browsers, leaving the candidate in silence with no cue — call play()
        // explicitly and, on rejection, raise a "tap to enable audio" recovery.
        void el
          .play()
          .then(() => setAudioBlocked(false))
          .catch(() => setAudioBlocked(true));
      }
      startOaiSpeakingMeter(e.streams[0]);
    };
    // H4: react to a mid-call connection drop. "disconnected" can be a transient blip, so debounce
    // it; "failed" is terminal. A stale connection (torn down / replaced) is ignored.
    pc.onconnectionstatechange = () => {
      if (pcRef.current !== pc) return;
      const st = pc.connectionState;
      if (st === "failed") {
        handleOaiDrop();
      } else if (st === "disconnected") {
        // bug-ui-scan-2026-07-09 (voice-interview #3): surface the degraded state
        // IMMEDIATELY (not after the 8s debounce), so the candidate knows to pause
        // instead of talking into a pipe that may already be gone.
        setUnstable(true);
        if (!dropTimerRef.current) {
          dropTimerRef.current = setTimeout(() => {
            dropTimerRef.current = null;
            if (pcRef.current === pc && (pc.connectionState === "disconnected" || pc.connectionState === "failed")) {
              handleOaiDrop();
            }
          }, 8000);
        }
      } else if (st === "connected") {
        // bug-ui-scan-2026-07-09 (voice-interview #3): recovered — drop the cue.
        setUnstable(false);
        if (dropTimerRef.current) {
          clearTimeout(dropTimerRef.current);
          dropTimerRef.current = null;
        }
      }
    };
    setAwaitingMic(true);
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    } finally {
      // Clear the hint whether the prompt was allowed, denied, or the call torn down —
      // it's only meaningful while the prompt is actually open.
      setAwaitingMic(false);
    }
    // The permission prompt can sit open for seconds; if the connect timeout or an
    // unmount tore down (or replaced) this connection meanwhile, stop the freshly
    // acquired tracks rather than leaving the microphone hot on a dead call.
    if (finalizedRef.current || pcRef.current !== pc) {
      mic.getTracks().forEach((tr) => tr.stop());
      return;
    }
    micRef.current = mic;
    mic.getTracks().forEach((tr) => pc.addTrack(tr, mic));

    const dc = pc.createDataChannel("oai-events");
    dcRef.current = dc;
    dc.onmessage = (e) => {
      try {
        handleOaiEvent(JSON.parse(e.data as string));
      } catch {
        /* non-JSON event */
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const resp = await fetch(`${c.callsUrl}?model=${encodeURIComponent(c.model)}`, {
      method: "POST",
      body: offer.sdp,
      headers: { Authorization: `Bearer ${c.clientSecret}`, "Content-Type": "application/sdp" },
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`OpenAI calls ${resp.status}: ${detail.slice(0, 200)}`);
    }
    await pc.setRemoteDescription({ type: "answer", sdp: await resp.text() });
    // Same guard as after getUserMedia: if the connect timeout fired (or this pc
    // was torn down / replaced) while dialing, don't present a live call that can
    // never be finalized — stop the connection we just built.
    if (finalizedRef.current || pcRef.current !== pc) {
      try {
        pc.getSenders().forEach((s) => s.track?.stop());
        pc.close();
      } catch {
        /* noop */
      }
      return;
    }
    clearConnectTimer();
    // Mark the call as having gone live (parity with the ElevenLabs onConnect at the top of
    // this file). The unmount transcript beacon and interviewFinalStatus both gate on this
    // ref; without it an in-progress OpenAI call lost its transcript on tab-close and a
    // hang-up couldn't be told from a never-live session. Safe here: we passed the
    // still-current-connection guard above, so a torn-down/replaced pc never marks live.
    reachedLiveRef.current = true;
    setPhase("live");
  }

  // Map a getUserMedia / connection failure to specific, actionable recovery copy — mic denial
  // is the most common real failure of a voice screen, and the raw DOMException message ("Permission
  // denied") tells the candidate nothing about how to recover.
  function micErrorText(e: unknown): string | null {
    const name = e instanceof DOMException ? e.name : "";
    const msg = e instanceof Error ? e.message : String(e ?? "");
    if (name === "NotAllowedError" || name === "SecurityError" || /permission|denied|dismiss/i.test(msg)) {
      return t("errMicDenied");
    }
    if (name === "NotFoundError" || name === "OverconstrainedError" || /no .*(microphone|audio)|device not found/i.test(msg)) {
      return t("errMicNotFound");
    }
    if (name === "NotReadableError" || name === "AbortError" || /in use|already in use|busy/i.test(msg)) {
      return t("errMicBusy");
    }
    return null;
  }

  async function start() {
    setConfirmingEnd(false);
    setSaveFailed(false);
    setMuted(false);
    setElapsed(0);
    stopMicTest(); // release the test mic before the real call claims the device
    setMicTest("idle");
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
      if (!res.ok) throw new Error(data.error || `connect failed (${res.status})`);
      sessionIdRef.current = data.sessionId;
      sessionTokenRef.current = (typeof data.token === "string" ? data.token : null) ?? token ?? null;
      const c = data.connect;
      if (c.provider === "openai") {
        await startOpenAi(c);
      } else {
        // Candidate sessions push a CANDIDATE-SAFE agent prompt as an override
        // (requires the ElevenLabs agent to allow overrides; otherwise it falls
        // back to the dashboard prompt). The recruiter's private interviewer
        // brief never reaches this response — the server sends only a generic
        // role-title prompt (backlog #29 / TP-L2-VOICE-01); OpenAI receives its
        // full brief server-side in the session config. phase → live via
        // onConnect.
        const agentPrompt: string | undefined = data.agentPrompt ?? undefined;
        // Pin the agent's LANGUAGE to the candidate's, not just via the prompt. The EL agent's
        // dashboard default is Czech (setup-eleven-agent.mjs), and the prompt's "follow the
        // candidate's language" rule loses to that config over voice (the voice-harness caught the
        // agent replying in Czech to an English candidate ~2/3 of the time). The agent allows the
        // language override, so send it whenever we have a concrete hint (candidate portal seeds it
        // from the visitor's locale; the lab's "auto" leaves detection to the agent).
        const agentOverride: { prompt?: { prompt: string }; language?: "cs" | "en" } = {};
        if (agentPrompt) agentOverride.prompt = { prompt: agentPrompt };
        if (language !== "auto") agentOverride.language = language;
        const maybe = conversation.startSession({
          signedUrl: c.signedUrl,
          connectionType: "websocket",
          ...(Object.keys(agentOverride).length ? { overrides: { agent: agentOverride } } : {}),
        }) as unknown;
        // Some SDK versions return a promise; surface a rejection instead of hanging.
        if (maybe && typeof (maybe as { then?: unknown }).then === "function") {
          (maybe as Promise<unknown>).catch((err) => {
            clearConnectTimer();
            setError(micErrorText(err) ?? (err instanceof Error ? err.message : t("errElevenConnect")));
            setPhase("error");
          });
        }
      }
    } catch (e) {
      clearConnectTimer();
      setError(micErrorText(e) ?? (e instanceof Error ? e.message : t("errStartCall")));
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
      <div className="flex flex-wrap gap-x-8 gap-y-4">
        {/* Language hint */}
        <div>
          <p className="text-meta uppercase text-steel">{t("languageLabel")}</p>
          <div className="mt-1.5 inline-flex rounded-lg border border-stone-200 bg-paper p-1">
            {(
              [
                ["auto", t("langAuto")],
                ["cs", "Čeština"],
                ["en", "English"],
              ] as [LangHint, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                disabled={isBusy}
                aria-pressed={language === v}
                onClick={() => setLanguage(v)}
                className={`focus-ring rounded-md px-3 py-1.5 text-base transition-colors ${
                  language === v ? "bg-white text-ink shadow-panel" : "text-steel hover:text-ink"
                } ${isBusy ? "cursor-not-allowed" : ""}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Provider picker */}
        <div>
          <p className="text-meta uppercase text-steel">{t("providerLabel")}</p>
          <div className="mt-1.5 inline-flex rounded-lg border border-stone-200 bg-paper p-1">
            {PROVIDER_ORDER.map((p) => {
              const active = provider === p;
              const off = availability ? !availability[p] : false;
              return (
                <button
                  key={p}
                  type="button"
                  disabled={isBusy || off}
                  aria-pressed={active}
                  onClick={() => setProvider(p)}
                  title={off ? t("keysNotConfigured", { provider: PROVIDER_LABEL[p] }) : undefined}
                  className={`focus-ring rounded-md px-3 py-1.5 text-base transition-colors ${
                    active ? "bg-white text-ink shadow-panel" : "text-steel hover:text-ink"
                  } ${off ? "cursor-not-allowed opacity-40" : isBusy ? "cursor-not-allowed" : ""}`}
                >
                  {PROVIDER_LABEL[p]}
                  {off ? ` · ${t("notSet")}` : ""}
                </button>
              );
            })}
          </div>
        </div>
      </div>
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
          {!isBusy ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-paper/50 px-4 py-3">
              <button
                type="button"
                onClick={testMic}
                disabled={micTest === "testing"}
                className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 text-base font-medium text-ink transition-colors hover:bg-paper disabled:opacity-50"
              >
                <Mic size={16} />
                {micTest === "testing" ? t("micTestListening") : t("micTestBtn")}
              </button>
              {micTest === "testing" ? (
                <div
                  className="h-2 w-32 overflow-hidden rounded-full bg-stone-200"
                  role="progressbar"
                  aria-label={t("micTestListening")}
                  aria-valuenow={Math.round(micLevel * 100)}
                >
                  <div
                    className="h-full rounded-full bg-moss transition-[width] duration-100"
                    style={{ width: `${Math.round(micLevel * 100)}%` }}
                  />
                </div>
              ) : null}
              {micTest === "heard" ? (
                <span className="inline-flex items-center gap-1.5 text-base text-moss">
                  <CheckCircle2 size={16} aria-hidden /> {t("micTestHeard")}
                </span>
              ) : null}
              {micTest === "silent" ? <span className="text-base text-coral">{t("micTestSilent")}</span> : null}
              {micTest === "denied" ? <span className="text-base text-coral">{t("errMicDenied")}</span> : null}
            </div>
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
            {/* M4: mute for a "give me a moment"; M3: elapsed timer for orientation — both live-only. */}
            {phase === "live" ? (
              <>
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-pressed={muted}
                  aria-label={muted ? t("unmuteMic") : t("muteMic")}
                  className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 text-base font-medium text-ink transition-colors hover:bg-paper"
                >
                  {muted ? <MicOff size={18} /> : <Mic size={18} />}
                  {muted ? t("muted") : t("muteMic")}
                </button>
                {/* bug-ui-scan-2026-07-09 (voice-interview #4): mute the AI's OUTPUT voice
                    (the interviewer), separate from the candidate mic mute above. */}
                <button
                  type="button"
                  onClick={toggleAudioMuted}
                  aria-pressed={audioMuted}
                  aria-label={audioMuted ? t("unmuteAudio") : t("muteAudio")}
                  className="focus-ring inline-flex h-11 items-center justify-center rounded-md border border-stone-300 bg-white px-3 text-base font-medium text-ink transition-colors hover:bg-paper"
                >
                  {audioMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
                <span
                  // bug-ui-scan-2026-07-09 (voice-interview #3): annotate the timer while
                  // the connection is degraded, so it doesn't read as normal progress.
                  className={`inline-flex items-center gap-1.5 text-meta tabular-nums ${unstable ? "text-dial-amber" : "text-steel"}`}
                  aria-label={t("elapsedLabel")}
                  title={unstable ? t("status.unstable") : undefined}
                >
                  <Clock size={14} aria-hidden />
                  {`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`}
                </span>
              </>
            ) : null}
            {/* bug-ui-scan-2026-07-09 (voice-interview #4): autoplay-blocked recovery —
                inside the aria-busy controls block so it's announced. */}
            {audioBlocked && phase === "live" ? (
              <button
                type="button"
                onClick={enableAudio}
                className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-md border border-dial-amber/50 bg-dial-amber/10 px-4 text-base font-semibold text-ink transition-colors hover:bg-dial-amber/20"
              >
                <Volume2 size={18} />
                {t("enableAudio")}
              </button>
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
      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2.5">
          <p className="flex items-center gap-2 text-meta uppercase text-steel">
            {t("liveTranscript")}
            {phase === "live" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-coral/10 px-2 py-0.5 text-coral">
                <span className="voice-listen h-1.5 w-1.5 rounded-full bg-coral" aria-hidden /> {t("liveBadge")}
              </span>
            ) : null}
          </p>
          {candidateLabel || jobTitle ? (
            <p className="truncate pl-2 text-meta text-steel">
              {candidateLabel}
              {candidateLabel && jobTitle ? " · " : ""}
              {jobTitle}
            </p>
          ) : null}
        </div>
        <div
          ref={logRef}
          role="log"
          aria-live="polite"
          aria-label="Live interview transcript"
          className="max-h-[520px] space-y-4 overflow-y-auto scroll-smooth p-4"
        >
          {turns.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-paper text-steel">
                <Mic size={20} aria-hidden />
              </span>
              <div>
                {/* Phase-aware: the idle "Press Start" copy contradicted the live phases
                    (it showed even while Connecting/Live/Ending with no turns yet). */}
                {phase === "connecting" ? (
                  <p className="text-base text-ink">{awaitingMic ? t("awaitingMic") : t("connecting")}</p>
                ) : phase === "live" ? (
                  <p className="text-base text-ink">{t("listeningFirst")}</p>
                ) : phase === "ending" ? (
                  <p className="text-base text-ink">{t("wrappingUp")}</p>
                ) : (
                  <>
                    <p className="text-base text-ink">{t("transcriptEmpty")}</p>
                    <p className="mt-1 text-sm text-steel">{t("transcriptHint")}</p>
                  </>
                )}
              </div>
            </div>
          ) : (
            turns.map((t, i) =>
              t.role === "system" ? (
                <p key={i} className="text-center text-sm text-steel">
                  {t.text}
                </p>
              ) : (
                <TranscriptTurn key={i} role={t.role} text={t.text} />
              )
            )
          )}
        </div>
      </div>
    </div>
  );
}

function TranscriptTurn({ role, text }: { role: "candidate" | "interviewer"; text: string }) {
  const t = useTranslations("interview.voice");
  const isCandidate = role === "candidate";
  return (
    <div className={`flex items-start gap-2.5 ${isCandidate ? "flex-row-reverse" : ""}`}>
      <span
        aria-hidden
        className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${
          isCandidate ? "bg-limewash text-moss" : "bg-ink text-white"
        }`}
      >
        {isCandidate ? <User size={14} /> : <Sparkles size={14} />}
      </span>
      <div className={`min-w-0 max-w-[82%] ${isCandidate ? "text-right" : ""}`}>
        <p className="text-meta uppercase text-steel">{isCandidate ? t("turnYou") : t("turnInterviewer")}</p>
        <p
          className={`mt-1 inline-block rounded-2xl px-3.5 py-2 text-left text-base leading-6 ${
            isCandidate
              ? "rounded-tr-sm bg-limewash text-ink"
              : "rounded-tl-sm border border-stone-200 bg-paper text-ink"
          }`}
        >
          {text}
        </p>
      </div>
    </div>
  );
}

function StatusPill({ phase, speaking, unstable }: { phase: Phase; speaking: boolean; unstable?: boolean }) {
  const t = useTranslations("interview.voice");
  // bug-ui-scan-2026-07-09 (voice-interview #3): a degraded connection overrides the
  // live speaking/listening cue. UNLIKE the live pill this IS a live region
  // (role="status") — it's a low-frequency, high-stakes transition the candidate
  // must hear ("stop talking, we're reconnecting"), not the per-turn spam the live
  // pill deliberately suppresses.
  if (phase === "live" && unstable) {
    return (
      <span
        role="status"
        className="inline-flex items-center gap-2 rounded-full bg-dial-amber/20 px-3 py-1 text-meta text-ink"
      >
        <span className="voice-listen h-2.5 w-2.5 rounded-full bg-dial-amber" aria-hidden />
        {t("status.unstable")}
      </span>
    );
  }
  // The LIVE pill is NOT a live region: its speaking↔listening label toggles on every
  // turn, and announcing each toggle spammed the SR output that the transcript log
  // (role="log") already carries. It stays a VISUAL cue only; the phase pill below keeps
  // role="status" because its transitions (connecting/ending/ended/error) are low-frequency
  // and aren't in the transcript.
  // Live gets a motion treatment: bouncing equalizer bars while the AI speaks,
  // a single breathing pulse while the candidate's mic is open.
  if (phase === "live") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-moss/15 px-3 py-1 text-meta text-moss">
        {speaking ? (
          <span className="flex h-3.5 items-end gap-[3px]" aria-hidden>
            <span className="voice-eq-bar h-full w-[3px] rounded-full bg-moss" style={{ animationDelay: "0ms" }} />
            <span className="voice-eq-bar h-full w-[3px] rounded-full bg-moss" style={{ animationDelay: "150ms" }} />
            <span className="voice-eq-bar h-full w-[3px] rounded-full bg-moss" style={{ animationDelay: "300ms" }} />
          </span>
        ) : (
          <span className="voice-listen h-2.5 w-2.5 rounded-full bg-moss" aria-hidden />
        )}
        {speaking ? t("status.aiSpeaking") : t("status.listening")}
      </span>
    );
  }
  const map: Record<Exclude<Phase, "live">, { label: string; cls: string; dot?: string }> = {
    idle: { label: t("status.ready"), cls: "bg-stone-100 text-steel" },
    connecting: { label: t("status.connecting"), cls: "bg-dial-amber/20 text-ink", dot: "bg-dial-amber" },
    ending: { label: t("status.ending"), cls: "bg-dial-amber/20 text-ink", dot: "bg-dial-amber" },
    ended: { label: t("status.ended"), cls: "bg-stone-100 text-steel" },
    error: { label: t("status.error"), cls: "bg-coral/10 text-coral" },
  };
  const s = map[phase];
  return (
    <span role="status" className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-meta ${s.cls}`}>
      {s.dot ? <span className={`voice-listen h-2 w-2 rounded-full ${s.dot}`} aria-hidden /> : null}
      {s.label}
    </span>
  );
}
