"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_SECONDARY } from "@/app/_components/ui/recipes";
import { startOpenAiCall, teardownOpenAi, type OaiRefs } from "@/app/_components/voice/transport/openai";
import type { RoleBrief } from "@/app/_lib/rolespec";
import type { VoiceTurn } from "@/app/_lib/voice/types";

// Voice input mode for the intake dialog — a deliberately LEAN sibling of the
// candidate VoiceInterview (no consent gate, no provider picker, no phase
// machine): mic button → OpenAI Realtime call → hang up → the transcript posts
// to /voice-complete and the extracted brief lands back in the session. Voice
// is an INPUT MODE: the session stays open and the text plane keeps the
// read-back/confirm contract. Reuses the shared OpenAI WebRTC transport
// (transport/openai.ts) so the wire protocol lives in one place.

type Phase = "idle" | "connecting" | "live" | "processing";

export type VoiceCompletePayload = {
  transcript: VoiceTurn[];
  brief: RoleBrief;
  shape: "power_unit" | "story" | null;
  extracted: boolean;
  source: "llm" | "deterministic";
};

export function JdsIntakeVoice({
  intakeId,
  disabled,
  onCompleted,
}: {
  intakeId: string;
  disabled: boolean;
  onCompleted: (payload: VoiceCompletePayload) => void;
}) {
  const t = useTranslations("library.tab.intake.voice");
  const [phase, setPhase] = useState<Phase>("idle");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const turnsRef = useRef<VoiceTurn[]>([]);
  const finalizedRef = useRef(false);
  const reachedLiveRef = useRef(false);
  // The transport's ref bundle — plain ref boxes, per its contract.
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

  const finish = async () => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    // A final utterance may still be buffered as streamed deltas at hang-up.
    if (candBufRef.current.trim()) {
      turnsRef.current.push({ role: "candidate", text: candBufRef.current.trim(), at: new Date().toISOString() });
      candBufRef.current = "";
    }
    teardownOpenAi(refs(), { setSpeaking, setUnstable: () => {}, setAudioBlocked: () => {} });
    const turns = turnsRef.current;
    turnsRef.current = [];
    if (turns.length === 0) {
      setPhase("idle");
      return;
    }
    setPhase("processing");
    try {
      const res = await fetch(`/api/intake/${encodeURIComponent(intakeId)}/voice-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onCompleted((await res.json()) as VoiceCompletePayload);
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
    turnsRef.current = [];
    try {
      const res = await fetch(`/api/intake/${encodeURIComponent(intakeId)}/voice-connect`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { connect: { model: string; clientSecret: string; callsUrl: string } };
      await startOpenAiCall(data.connect, {
        refs: refs(),
        finalizedRef,
        reachedLiveRef,
        pushTurn: (role, text) => {
          if (text.trim()) turnsRef.current.push({ role, text: text.trim(), at: new Date().toISOString() });
        },
        setSpeaking,
        setUnstable: () => {},
        setAudioBlocked: () => {},
        setAwaitingMic: () => {},
        setLive: () => setPhase("live"),
        clearConnectTimer: () => {},
        // A terminal drop ends the call but keeps what was said — the
        // transcript still posts, so nothing spoken is lost.
        onDrop: () => void finish(),
      });
    } catch {
      teardownOpenAi(refs(), { setSpeaking, setUnstable: () => {}, setAudioBlocked: () => {} });
      setError(true);
      setPhase("idle");
    }
  };

  useEffect(() => {
    // Unmount = hang up; the finalized guard makes this a no-op after a normal end.
    return () => {
      finalizedRef.current = true;
      teardownOpenAi(refs(), { setSpeaking: () => {}, setUnstable: () => {}, setAudioBlocked: () => {} });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (available === false) {
    return <span className="self-center text-meta text-steel">{t("unavailable")}</span>;
  }

  return (
    <>
      {/* The interviewer's voice — hidden element the transport streams into. */}
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
