"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_SECONDARY } from "@/app/_components/ui/recipes";
import {
  cancelSpeech,
  speakText,
  startOpenAiCall,
  teardownOpenAi,
  type OaiRefs,
} from "@/app/_components/voice/transport/openai";
import type { RoleBrief } from "@/app/_lib/rolespec";
import type { VoiceTurn } from "@/app/_lib/voice/types";
import {
  completeTurn,
  enqueueUtterance,
  initialOrchestratorState,
  spokenOpener,
  type OrchestratorState,
} from "./voiceOrchestration";

// Voice input mode for the intake dialog — the ORCHESTRATED design
// (docs/architecture/voice-conversation-plane.md): the provider session is a
// pure speech transport (relay mode, it never answers on its own); every
// transcribed utterance goes to /voice-turn where OUR engine produces the next
// spoken line, which we inject via speakText. The brief fills DURING the call
// through the periodic extraction sweep (/voice-complete without turns). All
// dialog state is server-side after every exchange, so a drop or a transport
// swap loses at most the utterance in flight (posted by the recovery path).

type Phase = "idle" | "connecting" | "live" | "processing";

export type VoiceSweepPayload = {
  transcript: VoiceTurn[];
  brief: RoleBrief;
  shape: "power_unit" | "story" | null;
  extracted: boolean;
  source: "llm" | "deterministic";
};

export function JdsIntakeVoice({
  intakeId,
  disabled,
  transcript,
  onExchange,
  onSweep,
}: {
  intakeId: string;
  disabled: boolean;
  /** The session transcript (for continuing the pending question aloud). */
  transcript: { role: string; text: string }[];
  /** One completed voice exchange — append the pair to the open session. Both
   *  callbacks carry the intake id they belong to: a sweep or a turn can resolve
   *  seconds after the requestor moved to another session, and the receiver
   *  drops what no longer matches (jdsIntakeLogic foldVoice*). */
  onExchange: (intakeId: string, payload: { userText: string; reply: string; done: boolean; brief?: RoleBrief }) => void;
  /** A periodic/final extraction sweep landed — fold the authoritative result in. */
  onSweep: (intakeId: string, payload: VoiceSweepPayload) => void;
}) {
  const t = useTranslations("library.tab.intake.voice");
  const [phase, setPhase] = useState<Phase>("idle");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  // The transport keeps the pushTurn closure it was handed at connect time, so
  // `speaking` READ from that render is frozen at false for the whole call and
  // barge-in never fired. Mirror it into a ref the live callback can read.
  const speakingRef = useRef(false);
  const markSpeaking = (v: boolean) => {
    speakingRef.current = v;
    setSpeaking(v);
  };
  const finalizedRef = useRef(false);
  const reachedLiveRef = useRef(false);
  const orchestratorRef = useRef<OrchestratorState>(initialOrchestratorState);
  // The utterance whose /voice-turn POST is in flight — the recovery payload if
  // the tab dies before the exchange persisted.
  const inFlightRef = useRef<string | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const dropTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const asstBufRef = useRef("");
  const candBufRef = useRef("");
  const pendingCandidateRef = useRef(false);

  const refs = (): OaiRefs => ({
    pc: pcRef,
    mic: micRef,
    dc: dcRef,
    audio: audioRef,
    audioCtx: audioCtxRef,
    raf: rafRef,
    dropTimer: dropTimerRef,
    asstBuf: asstBufRef,
    candBuf: candBufRef,
    pendingCandidate: pendingCandidateRef,
  });

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/intake/${encodeURIComponent(intakeId)}/voice-connect`);
        const data = (await res.json().catch(() => ({}))) as { availability?: { openai?: boolean } };
        setAvailable(res.ok ? data.availability?.openai === true : false);
      } catch {
        setAvailable(false);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [intakeId]);

  // The periodic extraction thread: sweep the STORED transcript (no body) and
  // fold the authoritative brief into the panel. Fire-and-forget by design.
  const sweep = async () => {
    try {
      const res = await fetch(`/api/intake/${encodeURIComponent(intakeId)}/voice-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) onSweep(intakeId, (await res.json()) as VoiceSweepPayload);
    } catch {
      /* the next sweep (or hang-up) catches up — extraction lag is by design */
    }
  };

  // The fast thread: one utterance → the engine's next spoken line.
  const dispatch = async (message: string) => {
    inFlightRef.current = message;
    let done = false;
    // What the requestor said but the server never received — handed back to the
    // orchestrator so it survives in the queue instead of vanishing.
    let failed: string | null = null;
    try {
      const res = await fetch(`/api/intake/${encodeURIComponent(intakeId)}/voice-turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { reply: string; done: boolean; brief?: RoleBrief };
      done = data.done;
      speakText(refs(), data.reply);
      onExchange(intakeId, { userText: message, reply: data.reply, done: data.done, brief: data.brief });
    } catch {
      setError(true);
      failed = message;
    } finally {
      inFlightRef.current = null;
      const { state, next, extract } = completeTurn(orchestratorRef.current, done, failed);
      orchestratorRef.current = state;
      if (extract) void sweep();
      if (next) void dispatch(next);
      if (done) {
        // Let the closing line play out before hanging up.
        window.setTimeout(() => void finish(), 6000);
      }
    }
  };

  const onUtterance = (text: string) => {
    // Barge-in: the requestor talking over the agent cancels the spoken reply.
    if (speakingRef.current) cancelSpeech(refs());
    const { state, dispatch: message } = enqueueUtterance(orchestratorRef.current, text);
    orchestratorRef.current = state;
    if (message) void dispatch(message);
  };

  const finish = async () => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    // Recovery: anything not yet persisted server-side — a buffered final
    // utterance, a queued one, or the one whose POST was in flight.
    const stray: VoiceTurn[] = [];
    const leftovers = [inFlightRef.current ?? "", ...orchestratorRef.current.queue, candBufRef.current];
    for (const text of leftovers) {
      if (text.trim()) stray.push({ role: "candidate", text: text.trim(), at: new Date().toISOString() });
    }
    candBufRef.current = "";
    teardownOpenAi(refs(), { setSpeaking: markSpeaking, setUnstable: () => {}, setAudioBlocked: () => {} });
    setPhase("processing");
    try {
      const res = await fetch(`/api/intake/${encodeURIComponent(intakeId)}/voice-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stray.length > 0 ? { turns: stray } : {}),
      });
      if (res.ok) onSweep(intakeId, (await res.json()) as VoiceSweepPayload);
      else if (res.status !== 400) throw new Error(`HTTP ${res.status}`);
    } catch {
      setError(true);
    } finally {
      setPhase("idle");
    }
  };

  const start = async () => {
    if (phase !== "idle" || disabled) return;
    setError(false);
    setPhase("connecting");
    finalizedRef.current = false;
    reachedLiveRef.current = false;
    orchestratorRef.current = initialOrchestratorState;
    try {
      const res = await fetch(`/api/intake/${encodeURIComponent(intakeId)}/voice-connect`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { connect: { model: string; clientSecret: string; callsUrl: string } };
      await startOpenAiCall(data.connect, {
        refs: refs(),
        finalizedRef,
        reachedLiveRef,
        pushTurn: (role, text) => {
          // Relay mode: assistant transcript events echo OUR injected lines —
          // the exchange is already recorded server-side, so only the
          // requestor's utterances drive anything here.
          if (role === "candidate") onUtterance(text);
        },
        setSpeaking: markSpeaking,
        setUnstable: () => {},
        setAudioBlocked: () => {},
        setAwaitingMic: () => {},
        setLive: () => {
          setPhase("live");
          // Continue the SAME conversation: speak the pending question from
          // the text thread instead of restarting.
          const opener = spokenOpener(transcript);
          if (opener) speakText(refs(), opener);
        },
        clearConnectTimer: () => {},
        // A terminal drop keeps everything already persisted; recovery posts
        // whatever was still in flight.
        onDrop: () => void finish(),
      });
    } catch {
      teardownOpenAi(refs(), { setSpeaking: markSpeaking, setUnstable: () => {}, setAudioBlocked: () => {} });
      setError(true);
      setPhase("idle");
    }
  };

  useEffect(() => {
    return () => {
      finalizedRef.current = true;
      teardownOpenAi(refs(), { setSpeaking: () => {}, setUnstable: () => {}, setAudioBlocked: () => {} });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (available === false) {
    // Recertify R-1: rendered inside the composer's flex ROW, this long note
    // squeezed the textarea to a sliver on every keyless deploy. basis-full +
    // order-last wraps it onto its own quiet line under the composer instead
    // (the row is flex-wrap).
    return <span className="order-last basis-full text-meta text-steel">{t("unavailable")}</span>;
  }

  return (
    <>
      {/* The agent's voice — hidden element the transport streams into. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} autoPlay className="hidden" />
      {phase === "idle" ? (
        <button
          type="button"
          className={`${BTN_SECONDARY} h-10 px-3 text-sm`}
          disabled={disabled || available !== true}
          onClick={start}
          title={t("startHint")}
        >
          {t("start")}
        </button>
      ) : phase === "connecting" ? (
        <span className="self-center text-meta text-steel">{t("connecting")}</span>
      ) : phase === "processing" ? (
        <span className="self-center text-meta text-steel">{t("processing")}</span>
      ) : (
        <button type="button" className={`${BTN_SECONDARY} h-10 px-3 text-sm`} onClick={() => void finish()}>
          <span className={speaking ? "text-coral" : undefined}>{t("stop")}</span>
        </button>
      )}
      {error ? <span className="self-center text-meta text-red-700">{t("failed")}</span> : null}
    </>
  );
}
