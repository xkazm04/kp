"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_GHOST, BTN_SECONDARY } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
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
import {
  apiFailure,
  initialVoiceUiState,
  micFailure,
  readAvailability,
  scheduleHangUp,
  voiceUiReducer,
  type VoiceAvailability,
  type VoiceFailure,
} from "./voicePhase";

// Voice input mode for the intake dialog — the ORCHESTRATED design
// (docs/architecture/voice-conversation-plane.md): the provider session is a
// pure speech transport (relay mode, it never answers on its own); every
// transcribed utterance goes to /voice-turn where OUR engine produces the next
// spoken line, which we inject via speakText. The brief fills DURING the call
// through the periodic extraction sweep (/voice-complete without turns). All
// dialog state is server-side after every exchange, so a drop or a transport
// swap loses at most the utterance in flight (posted by the recovery path).
//
// Phase, failure and the two transient cues live in voicePhase.ts (pure, tested);
// this component is the driver that connects them to the transport and the routes.

export type VoiceSweepPayload = {
  transcript: VoiceTurn[];
  brief: RoleBrief;
  shape: "power_unit" | "story" | null;
  extracted: boolean;
  source: "llm" | "deterministic";
};

/** The DOM timer seam for the post-close hang-up (voicePhase.scheduleHangUp). */
const domTimers = {
  set: (fn: () => void, ms: number) => window.setTimeout(fn, ms),
  clear: (handle: unknown) => window.clearTimeout(handle as number),
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
  // The microphone-recovery copy is the candidate voice screen's, verbatim: one
  // classifier (micErrorText) and one set of sentences for both surfaces.
  const tMic = useTranslations("interview.voice");
  const resolveError = useErrorMessage();
  const [ui, dispatchUi] = useReducer(voiceUiReducer, initialVoiceUiState);
  const { phase } = ui;
  const [availability, setAvailability] = useState<VoiceAvailability>("checking");
  // Bumped by the re-check button: a probe that did not land says nothing about
  // the install, so the requestor can ask again.
  const [probe, setProbe] = useState(0);
  const [speaking, setSpeaking] = useState(false);

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
  // Cancels the pending post-close hang-up (scheduleHangUp) — the unmount effect
  // and an explicit "End call" both call it.
  const hangUpRef = useRef<(() => void) | null>(null);
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
        const data = (await res.json().catch(() => ({}))) as unknown;
        setAvailability(readAvailability(res.ok, data));
      } catch {
        // The probe itself failed — that is a fact about the network, not about
        // whether this install has a provider configured.
        setAvailability("unknown");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [intakeId, probe]);

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

  /** Read a non-ok response's machine code without ever reading its prose. */
  const failureOf = async (res: Response): Promise<VoiceFailure> =>
    apiFailure(res.status, await res.json().catch(() => null));

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
      if (!res.ok) {
        // A rate-limited utterance and a provider outage are different things to
        // the requestor: one means "slow down", the other means "stop talking".
        dispatchUi({ type: "turnFailed", failure: await failureOf(res) });
        failed = message;
      } else {
        const data = (await res.json()) as { reply: string; done: boolean; brief?: RoleBrief };
        done = data.done;
        speakText(refs(), data.reply);
        onExchange(intakeId, { userText: message, reply: data.reply, done: data.done, brief: data.brief });
      }
    } catch {
      dispatchUi({ type: "turnFailed", failure: { kind: "transport" } });
      failed = message;
    } finally {
      inFlightRef.current = null;
      const { state, next, extract } = completeTurn(orchestratorRef.current, done, failed);
      orchestratorRef.current = state;
      if (extract) void sweep();
      if (next) void dispatch(next);
      if (done) {
        // Let the closing line play out before hanging up — cancellable, so an
        // unmount during those seconds does not hang up a dead component.
        hangUpRef.current?.();
        hangUpRef.current = scheduleHangUp(() => void finish(), domTimers);
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
    hangUpRef.current?.();
    hangUpRef.current = null;
    // Recovery: anything not yet persisted server-side — a buffered final
    // utterance, a queued one, or the one whose POST was in flight.
    const stray: VoiceTurn[] = [];
    const leftovers = [inFlightRef.current ?? "", ...orchestratorRef.current.queue, candBufRef.current];
    for (const text of leftovers) {
      if (text.trim()) stray.push({ role: "candidate", text: text.trim(), at: new Date().toISOString() });
    }
    candBufRef.current = "";
    teardownOpenAi(refs(), { setSpeaking: markSpeaking, setUnstable: () => {}, setAudioBlocked: () => {} });
    dispatchUi({ type: "finishing" });
    let failure: VoiceFailure | null = null;
    try {
      const res = await fetch(`/api/intake/${encodeURIComponent(intakeId)}/voice-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stray.length > 0 ? { turns: stray } : {}),
      });
      if (res.ok) onSweep(intakeId, (await res.json()) as VoiceSweepPayload);
      // 400 is "nothing to extract" on an empty call — not a fault.
      else if (res.status !== 400) failure = await failureOf(res);
    } catch {
      failure = { kind: "transport" };
    } finally {
      dispatchUi({ type: "finished", failure });
    }
  };

  const start = async () => {
    if (phase !== "idle" || disabled) return;
    dispatchUi({ type: "start" });
    finalizedRef.current = false;
    reachedLiveRef.current = false;
    orchestratorRef.current = initialOrchestratorState;
    let connect: { model: string; clientSecret: string; callsUrl: string };
    try {
      const res = await fetch(`/api/intake/${encodeURIComponent(intakeId)}/voice-connect`, { method: "POST" });
      if (!res.ok) {
        // The mint refused with a code — keyless install, closed session, rate
        // limit. Each of those already has its own sentence in the catalogs.
        dispatchUi({ type: "connectFailed", failure: await failureOf(res) });
        return;
      }
      connect = ((await res.json()) as { connect: { model: string; clientSecret: string; callsUrl: string } }).connect;
    } catch {
      dispatchUi({ type: "connectFailed", failure: { kind: "transport" } });
      return;
    }
    try {
      await startOpenAiCall(connect, {
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
        setAudioBlocked: (value) => dispatchUi({ type: "audioBlocked", value }),
        setAwaitingMic: (value) => dispatchUi({ type: "awaitingMic", value }),
        setLive: () => {
          dispatchUi({ type: "live" });
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
    } catch (error) {
      teardownOpenAi(refs(), { setSpeaking: markSpeaking, setUnstable: () => {}, setAudioBlocked: () => {} });
      // A blocked microphone is the most common failure here AND the only one
      // the requestor can fix themselves — it gets the browser-permission line,
      // not the generic "the call didn't go through".
      dispatchUi({ type: "connectFailed", failure: micFailure(error) });
    }
  };

  useEffect(() => {
    return () => {
      finalizedRef.current = true;
      hangUpRef.current?.();
      hangUpRef.current = null;
      teardownOpenAi(refs(), { setSpeaking: () => {}, setUnstable: () => {}, setAudioBlocked: () => {} });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (availability === "unconfigured" || availability === "unknown") {
    // Recertify R-1: rendered inside the composer's flex ROW, this long note
    // squeezed the textarea to a sliver on every keyless deploy. basis-full +
    // order-last wraps it onto its own quiet line under the composer instead
    // (the row is flex-wrap).
    //
    // The two states are NOT the same claim: "unconfigured" is what the install
    // said about itself; "unknown" is that we could not ask (a 429, a blip), and
    // announcing a keyless server from that was a lie the operator could not act
    // on. The second one is re-checkable.
    return (
      <span className="order-last flex basis-full flex-wrap items-center gap-2 text-meta text-steel">
        {availability === "unconfigured" ? t("unavailable") : t("checkFailed")}
        {availability === "unknown" ? (
          <button type="button" className={`${BTN_GHOST} h-7 px-2 text-sm`} onClick={() => setProbe((n) => n + 1)}>
            {t("recheck")}
          </button>
        ) : null}
      </span>
    );
  }

  const failureText = (failure: VoiceFailure): string => {
    if (failure.kind === "mic") {
      return failure.reason === "denied"
        ? tMic("errMicDenied")
        : failure.reason === "notFound"
          ? tMic("errMicNotFound")
          : tMic("errMicBusy");
    }
    if (failure.kind === "api") return resolveError({ code: failure.code }, t("failed"));
    return t("failed");
  };

  return (
    <>
      {/* The agent's voice — hidden element the transport streams into. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} autoPlay className="hidden" />
      {phase === "idle" ? (
        <button
          type="button"
          className={`${BTN_SECONDARY} h-10 px-3 text-sm`}
          disabled={disabled || availability !== "ready"}
          onClick={start}
          title={t("startHint")}
        >
          {t("start")}
        </button>
      ) : phase === "connecting" ? (
        <span className="self-center text-meta text-steel">{ui.awaitingMic ? tMic("awaitingMic") : t("connecting")}</span>
      ) : phase === "processing" ? (
        <span className="self-center text-meta text-steel">{t("processing")}</span>
      ) : (
        <button type="button" className={`${BTN_SECONDARY} h-10 px-3 text-sm`} onClick={() => void finish()}>
          <span className={speaking ? "text-coral" : undefined}>{t("stop")}</span>
        </button>
      )}
      {ui.audioBlocked ? (
        // Autoplay refused: the agent is talking into a muted element. One tap
        // inside a user gesture is all the browser wants.
        <button
          type="button"
          className={`${BTN_GHOST} h-8 self-center px-2 text-sm`}
          onClick={() =>
            void audioRef.current
              ?.play()
              .then(() => dispatchUi({ type: "audioBlocked", value: false }))
              // Still refused (no gesture credit, or the element was torn down):
              // leave the cue up rather than pretending the audio is running.
              .catch(() => dispatchUi({ type: "audioBlocked", value: true }))
          }
        >
          {tMic("enableAudio")}
        </button>
      ) : null}
      {ui.failure ? (
        <span className="order-last basis-full text-meta text-red-700">{failureText(ui.failure)}</span>
      ) : null}
    </>
  );
}
