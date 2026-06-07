"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { Mic, PhoneOff, Sparkles, User } from "lucide-react";
import { parseOaiTranscriptEvent } from "@/app/_lib/voice/openai";
// Provider id, transcript turn, and availability map are single-sourced in the
// voice adapter layer. Import from voice/types (not the package index, which
// pulls the server-only adapters into the bundle); these are type-only, so the
// import is erased at compile time.
import type { VoiceAvailability, VoiceProviderId, VoiceTurn } from "@/app/_lib/voice/types";
// Browser-safe pure helper (no server deps), so the "what counts as completed"
// decision is single-sourced and unit-tested rather than inline in a callback.
import { interviewFinalStatus } from "@/app/_lib/voice/finalize-status";
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
};

// ElevenLabs is the preferred default; the picker falls back to whatever is
// actually configured once availability resolves (see the effect below).
const DEFAULT_PROVIDER: VoiceProviderId = "elevenlabs";
const PROVIDER_ORDER: VoiceProviderId[] = ["elevenlabs", "openai"];

// How long finalize() waits for a candidate utterance whose transcription is
// still in flight when the call ends (idea-b70b8bd7). Whisper turnaround for a
// short closing answer is well under this; past it we fall back to whatever
// streamed into the delta buffer rather than hanging the "Ending…" state.
const OAI_FINAL_TURN_GRACE_MS = 2000;

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

function VoiceInterviewInner({ token, candidateLabel, jobTitle }: VoiceInterviewProps) {
  const [availability, setAvailability] = useState<VoiceAvailability | null>(null);
  const [provider, setProvider] = useState<VoiceProviderId>(DEFAULT_PROVIDER);
  const [consent, setConsent] = useState(false);
  const [language, setLanguage] = useState<LangHint>("auto");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
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
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
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
    pcRef.current = null;
    dcRef.current = null;
    micRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
  }, []);

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
      // transcription deltas streamed in (empty on whisper-1 — then the turn is
      // genuinely unrecoverable, but we no longer drop one we already hold).
      pushTurn("candidate", candBuf.current);
      candBuf.current = "";
      pendingCandidateRef.current = false;
      teardownOpenAi();
      setPhase("ended");
      const sid = sessionIdRef.current;
      const tok = sessionTokenRef.current ?? token ?? null;
      if (sid && tok) {
        try {
          await fetch("/api/interview/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: tok, sessionId: sid, transcript: turnsRef.current, status }),
          });
        } catch {
          /* best-effort persist */
        }
      }
    },
    [teardownOpenAi, clearConnectTimer, pushTurn, token]
  );

  const conversation = useConversation({
    onConnect: () => {
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
      void finalize(
        interviewFinalStatus({
          errored: erroredRef.current,
          reachedLive: reachedLiveRef.current,
          turnCount: turnsRef.current.length,
        })
      );
    },
    onError: (message: string) => {
      clearConnectTimer();
      erroredRef.current = true;
      setError(message || "Voice session error");
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
        if (avail) setProvider((cur) => (avail[cur] ? cur : (PROVIDER_ORDER.find((p) => avail[p]) ?? cur)));
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
      teardownOpenAi();
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

  async function startOpenAi(c: { model: string; clientSecret: string; callsUrl: string }) {
    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    pc.ontrack = (e) => {
      if (audioRef.current) audioRef.current.srcObject = e.streams[0];
    };
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
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
    clearConnectTimer();
    setPhase("live");
  }

  async function start() {
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
    setTurns([]);
    turnsRef.current = [];
    asstBuf.current = "";
    candBuf.current = "";
    pendingCandidateRef.current = false;
    finalizedRef.current = false;
    reachedLiveRef.current = false;
    erroredRef.current = false;
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
      setError(
        "Couldn't connect within 30s. Check microphone permission, that the provider is configured, and (ElevenLabs) that the agent allows overrides."
      );
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
        // For grounded (candidate) sessions, push the questions as a prompt
        // override (requires the ElevenLabs agent to allow overrides; otherwise
        // it falls back to the dashboard prompt). phase → live via onConnect.
        const groundedPrompt: string | undefined = data.groundedPrompt ?? undefined;
        const maybe = conversation.startSession({
          signedUrl: c.signedUrl,
          connectionType: "websocket",
          ...(groundedPrompt ? { overrides: { agent: { prompt: { prompt: groundedPrompt } } } } : {}),
        }) as unknown;
        // Some SDK versions return a promise; surface a rejection instead of hanging.
        if (maybe && typeof (maybe as { then?: unknown }).then === "function") {
          (maybe as Promise<unknown>).catch((err) => {
            clearConnectTimer();
            setError(err instanceof Error ? err.message : "ElevenLabs failed to connect");
            setPhase("error");
          });
        }
      }
    } catch (e) {
      clearConnectTimer();
      setError(e instanceof Error ? e.message : "Failed to start the call");
      setPhase("error");
      teardownOpenAi();
    }
  }

  async function end() {
    setPhase("ending");
    if (providerRef.current === "elevenlabs") {
      try {
        conversation.endSession();
      } catch {
        /* noop */
      }
    }
    await finalize("completed");
  }

  const isBusy = phase === "connecting" || phase === "live" || phase === "ending";
  const liveProvider = provider;
  const providerAvailable = availability ? availability[liveProvider] : true;

  const liveOrEnding = phase === "live" || phase === "ending";

  return (
    <div className="space-y-6">
      <audio ref={audioRef} autoPlay hidden />

      {/* Settings — language + provider, side by side. The provider picker
          defaults to ElevenLabs and disables any provider whose keys aren't
          configured. Both lock once a call is in flight. */}
      <div className="flex flex-wrap gap-x-8 gap-y-4">
        {/* Language hint */}
        <div>
          <p className="text-meta uppercase text-steel">Language</p>
          <div className="mt-1.5 inline-flex rounded-lg border border-stone-200 bg-paper p-1">
            {(
              [
                ["auto", "Auto-detect"],
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
          <p className="text-meta uppercase text-steel">Voice provider</p>
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
                  title={off ? `${PROVIDER_LABEL[p]} — keys not configured` : undefined}
                  className={`focus-ring rounded-md px-3 py-1.5 text-base transition-colors ${
                    active ? "bg-white text-ink shadow-panel" : "text-steel hover:text-ink"
                  } ${off ? "cursor-not-allowed opacity-40" : isBusy ? "cursor-not-allowed" : ""}`}
                >
                  {PROVIDER_LABEL[p]}
                  {off ? " · not set" : ""}
                </button>
              );
            })}
          </div>
        </div>
      </div>

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
          I understand this is an <span className="font-medium">AI-conducted</span> first-round screen and that the
          conversation is <span className="font-medium">transcribed</span> for a human recruiter to review. No audio is
          stored.
        </span>
      </label>

      {/* Controls */}
      <div
        className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-paper/50 px-4 py-3"
        aria-busy={phase === "connecting"}
      >
        {!liveOrEnding ? (
          <button
            type="button"
            onClick={start}
            disabled={!consent || phase === "connecting" || !providerAvailable}
            className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-md bg-ink px-5 text-base font-semibold text-white transition-colors hover:bg-steel disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Mic size={18} />
            {phase === "connecting" ? "Connecting…" : phase === "ended" ? "Start again" : "Start the call"}
          </button>
        ) : (
          <button
            type="button"
            onClick={end}
            disabled={phase === "ending"}
            className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-md bg-coral px-5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <PhoneOff size={18} />
            {phase === "ending" ? "Ending…" : "End call"}
          </button>
        )}
        <StatusPill phase={phase} speaking={conversation.isSpeaking} />
        {!providerAvailable ? (
          <span className="text-meta text-coral">{PROVIDER_LABEL[liveProvider]} keys not configured</span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-coral/30 bg-coral/5 px-3 py-2 text-base text-coral">
          {error}
        </p>
      ) : null}

      {/* Transcript */}
      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2.5">
          <p className="flex items-center gap-2 text-meta uppercase text-steel">
            Live transcript
            {phase === "live" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-coral/10 px-2 py-0.5 text-coral">
                <span className="voice-listen h-1.5 w-1.5 rounded-full bg-coral" aria-hidden /> Live
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
                <Mic size={20} />
              </span>
              <div>
                <p className="text-base text-ink">Your conversation will appear here.</p>
                <p className="mt-1 text-sm text-steel">
                  Press “Start the call” when you’re ready — the transcript builds live as you talk.
                </p>
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
        <p className="text-meta uppercase text-steel">{isCandidate ? "You" : "Interviewer"}</p>
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

function StatusPill({ phase, speaking }: { phase: Phase; speaking: boolean }) {
  // role="status" → implicit aria-live="polite" so phase/speaking changes are
  // announced to screen readers without stealing focus.
  // Live gets a motion treatment: bouncing equalizer bars while the AI speaks,
  // a single breathing pulse while the candidate's mic is open.
  if (phase === "live") {
    return (
      <span
        role="status"
        className="inline-flex items-center gap-2 rounded-full bg-moss/15 px-3 py-1 text-meta text-moss"
      >
        {speaking ? (
          <span className="flex h-3.5 items-end gap-[3px]" aria-hidden>
            <span className="voice-eq-bar h-full w-[3px] rounded-full bg-moss" style={{ animationDelay: "0ms" }} />
            <span className="voice-eq-bar h-full w-[3px] rounded-full bg-moss" style={{ animationDelay: "150ms" }} />
            <span className="voice-eq-bar h-full w-[3px] rounded-full bg-moss" style={{ animationDelay: "300ms" }} />
          </span>
        ) : (
          <span className="voice-listen h-2.5 w-2.5 rounded-full bg-moss" aria-hidden />
        )}
        {speaking ? "AI speaking" : "Listening"}
      </span>
    );
  }
  const map: Record<Exclude<Phase, "live">, { label: string; cls: string; dot?: string }> = {
    idle: { label: "Ready", cls: "bg-stone-100 text-steel" },
    connecting: { label: "Connecting…", cls: "bg-dial-amber/20 text-ink", dot: "bg-dial-amber" },
    ending: { label: "Ending…", cls: "bg-dial-amber/20 text-ink", dot: "bg-dial-amber" },
    ended: { label: "Call ended", cls: "bg-stone-100 text-steel" },
    error: { label: "Error", cls: "bg-coral/10 text-coral" },
  };
  const s = map[phase];
  return (
    <span role="status" className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-meta ${s.cls}`}>
      {s.dot ? <span className={`voice-listen h-2 w-2 rounded-full ${s.dot}`} aria-hidden /> : null}
      {s.label}
    </span>
  );
}
