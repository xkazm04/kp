"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";

// Live voice-interview MVP. OpenAI Realtime runs over raw WebRTC; ElevenLabs
// runs through the @elevenlabs/react SDK. A switcher lets you A/B both on the
// same short script. The server (/api/interview/connect) mints short-lived
// creds so no API key reaches the browser; the transcript is POSTed to
// /api/interview/complete on hang-up.

type Provider = "openai" | "elevenlabs";
type Turn = { role: "candidate" | "interviewer" | "system"; text: string; at: string };
type Availability = Record<Provider, boolean>;
type Phase = "idle" | "connecting" | "live" | "ending" | "ended" | "error";
type LangHint = "auto" | "cs" | "en";

const PROVIDER_LABEL: Record<Provider, string> = { openai: "OpenAI Realtime", elevenlabs: "ElevenLabs Agents" };

export type VoiceInterviewProps = {
  token?: string;
  fixedProvider?: Provider;
  candidateLabel?: string;
  jobTitle?: string;
  /** Candidate-facing agenda — run-of-show titles only (no questions). */
  runOfShow?: string[];
};

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
  fixedProvider,
  candidateLabel,
  jobTitle,
  runOfShow,
}: VoiceInterviewProps) {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [provider, setProvider] = useState<Provider>(fixedProvider ?? "openai");
  const [consent, setConsent] = useState(false);
  const [language, setLanguage] = useState<LangHint>("auto");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);

  // Refs avoid stale closures inside provider callbacks / teardown.
  const sessionIdRef = useRef<string | null>(null);
  const providerRef = useRef<Provider>(provider);
  const turnsRef = useRef<Turn[]>([]);
  const finalizedRef = useRef(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const asstBuf = useRef("");
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const pushTurn = useCallback((role: Turn["role"], text: string) => {
    const t = (text ?? "").trim();
    if (!t) return;
    const turn: Turn = { role, text: t, at: new Date().toISOString() };
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
      // Flush any AI turn still buffered from output_audio_transcript.delta
      // events. Teardown can fire before the matching .done arrives (the
      // candidate hangs up mid-sentence, or .done never lands), which would
      // otherwise silently drop the final interviewer turn from the transcript
      // that feeds the scorecard. pushTurn updates turnsRef synchronously, so
      // the flushed turn is included in the POST body below.
      pushTurn("interviewer", asstBuf.current);
      asstBuf.current = "";
      teardownOpenAi();
      setPhase("ended");
      const sid = sessionIdRef.current;
      if (sid) {
        try {
          await fetch("/api/interview/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: sid, transcript: turnsRef.current, status }),
          });
        } catch {
          /* best-effort persist */
        }
      }
    },
    [teardownOpenAi, clearConnectTimer, pushTurn]
  );

  const conversation = useConversation({
    onConnect: () => {
      clearConnectTimer();
      setPhase("live");
    },
    onDisconnect: () => {
      if (providerRef.current === "elevenlabs") void finalize("completed");
    },
    onError: (message: string) => {
      clearConnectTimer();
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
        if (!cancelled) setAvailability(d.availability ?? null);
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
    const type = String(ev.type ?? "");
    if (type.endsWith("input_audio_transcription.completed") && typeof ev.transcript === "string") {
      pushTurn("candidate", ev.transcript);
    } else if (type.includes("output_audio_transcript.delta") && typeof ev.delta === "string") {
      asstBuf.current += ev.delta;
    } else if (type.includes("output_audio_transcript.done")) {
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
    setError(null);
    setTurns([]);
    turnsRef.current = [];
    asstBuf.current = "";
    finalizedRef.current = false;
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
          provider: fixedProvider ?? provider,
          token,
          consent,
          language: language === "auto" ? undefined : language,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `connect failed (${res.status})`);
      sessionIdRef.current = data.sessionId;
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
  const liveProvider = fixedProvider ?? provider;
  const providerAvailable = availability ? availability[liveProvider] : true;

  const hasAgenda = Boolean(runOfShow && runOfShow.length);

  return (
    <div className={hasAgenda ? "grid gap-7 md:grid-cols-[260px_minmax(0,1fr)]" : ""}>
      {hasAgenda ? <RunOfShowAgenda items={runOfShow ?? []} /> : null}
      <div className="space-y-5">
      <audio ref={audioRef} autoPlay hidden />

      {/* Provider switcher */}
      {!fixedProvider ? (
        <div>
          <p className="text-meta uppercase text-steel">Provider</p>
          <div className="mt-1 inline-flex rounded-lg border border-stone-200 bg-paper p-1">
            {(["openai", "elevenlabs"] as Provider[]).map((p) => {
              const active = provider === p;
              const off = availability ? !availability[p] : false;
              return (
                <button
                  key={p}
                  type="button"
                  disabled={isBusy || off}
                  aria-pressed={active}
                  onClick={() => setProvider(p)}
                  title={off ? `${PROVIDER_LABEL[p]} not configured` : undefined}
                  className={`focus-ring rounded-md px-4 py-2 text-base font-medium transition-colors ${
                    active ? "bg-white text-ink shadow-panel" : "text-steel hover:text-ink"
                  } ${off ? "opacity-40" : ""} ${isBusy ? "cursor-not-allowed" : ""}`}
                >
                  {PROVIDER_LABEL[p]}
                  {off ? " · not set" : ""}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="text-base text-steel">
          Provider: <span className="font-medium text-ink">{PROVIDER_LABEL[liveProvider]}</span>
        </p>
      )}

      {/* Language hint */}
      <div>
        <p className="text-meta uppercase text-steel">Language</p>
        <div className="mt-1 inline-flex rounded-lg border border-stone-200 bg-paper p-1">
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

      {/* Consent */}
      <label className="flex max-w-2xl items-start gap-2 text-base text-ink">
        <input
          type="checkbox"
          checked={consent}
          disabled={isBusy}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-1"
        />
        <span>
          I understand this is an <span className="font-medium">AI-conducted</span> first-round screen and that the
          conversation is <span className="font-medium">transcribed</span> for a human recruiter to review. (No audio is
          stored.)
        </span>
      </label>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3" aria-busy={phase === "connecting"}>
        {phase !== "live" && phase !== "ending" ? (
          <button
            type="button"
            onClick={start}
            disabled={!consent || phase === "connecting" || !providerAvailable}
            className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-md bg-ink px-5 text-base font-semibold text-white hover:bg-steel disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === "connecting" ? "Connecting…" : phase === "ended" ? "Start again" : "Start the call"}
          </button>
        ) : (
          <button
            type="button"
            onClick={end}
            disabled={phase === "ending"}
            className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-md bg-coral px-5 text-base font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
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
      <div className="rounded-lg border border-stone-200 bg-white">
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2">
          <p className="text-meta uppercase text-steel">Live transcript</p>
          {candidateLabel || jobTitle ? (
            <p className="text-meta text-steel">
              {candidateLabel}
              {candidateLabel && jobTitle ? " · " : ""}
              {jobTitle}
            </p>
          ) : null}
        </div>
        <div
          role="log"
          aria-live="polite"
          aria-label="Live interview transcript"
          className="max-h-[520px] space-y-3 overflow-y-auto p-4"
        >
          {turns.length === 0 ? (
            <p className="text-base text-steel">The transcript will appear here as you talk.</p>
          ) : (
            turns.map((t, i) => (
              <div key={i} className={t.role === "candidate" ? "text-right" : ""}>
                <p className="text-meta uppercase text-steel">
                  {t.role === "candidate" ? "Candidate" : t.role === "interviewer" ? "Interviewer (AI)" : "System"}
                </p>
                <p
                  className={`mt-0.5 inline-block max-w-[85%] rounded-lg px-3 py-2 text-base leading-6 ${
                    t.role === "candidate" ? "bg-limewash text-ink" : "bg-paper text-ink"
                  }`}
                >
                  {t.text}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

function RunOfShowAgenda({ items }: { items: string[] }) {
  return (
    <aside className="rounded-lg border border-stone-200 bg-paper p-3 md:sticky md:top-4 md:self-start">
      <p className="text-meta uppercase text-steel">Today’s agenda</p>
      <ol className="mt-2 space-y-1.5">
        {items.map((t, i) => (
          <li key={i} className="flex items-start gap-2 text-base text-ink">
            <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border border-stone-300 text-[10px] text-steel">
              {i + 1}
            </span>
            <span>{t}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-meta text-steel">Your interviewer will guide you through each step.</p>
    </aside>
  );
}

function StatusPill({ phase, speaking }: { phase: Phase; speaking: boolean }) {
  const map: Record<Phase, { label: string; cls: string }> = {
    idle: { label: "Ready", cls: "bg-stone-100 text-steel" },
    connecting: { label: "Connecting…", cls: "bg-dial-amber/20 text-ink" },
    live: { label: speaking ? "AI speaking…" : "Listening…", cls: "bg-moss/15 text-moss" },
    ending: { label: "Ending…", cls: "bg-dial-amber/20 text-ink" },
    ended: { label: "Call ended", cls: "bg-stone-100 text-steel" },
    error: { label: "Error", cls: "bg-coral/10 text-coral" },
  };
  const s = map[phase];
  // role="status" → implicit aria-live="polite" so phase/speaking changes are
  // announced to screen readers without stealing focus.
  return (
    <span role="status" className={`rounded-full px-3 py-1 text-meta ${s.cls}`}>
      {s.label}
    </span>
  );
}
