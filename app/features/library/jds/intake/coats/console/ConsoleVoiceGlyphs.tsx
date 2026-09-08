"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Mic, MicOff, PhoneOff, Radio, Square, Volume2, VolumeX } from "lucide-react";
import { micLevelPercent } from "@/app/_components/voice/useMicTest";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { IconAction } from "../IconAction";
import { useIntakeDictation } from "../../useIntakeDictation";
import { useIntakeSpeech } from "../../useIntakeSpeech";
import { readAvailability, type VoiceAvailability } from "../../voicePhase";
import { JdsIntakeVoice } from "../../JdsIntakeVoice";
import type { VoiceSweepPayload } from "../../JdsIntakeVoice";
import type { RoleBrief } from "@/app/_lib/rolespec";

// THE THREE VOICE CONTROLS, as glyphs.
//
// The shipped composer says the same three things in prose: "Dictation is not
// set up on this server; typing works as usual", "Read-aloud is not set up on
// this server", "Voice isn't configured on this server. Continue in text." Three
// sentences occupying three lines of a working surface to report three
// capabilities that are simply ABSENT — and the absence is a picture: a struck
// microphone, a muted speaker, a hung-up phone. Console draws the negative state
// (`tone="muted"`, the off-glyph) and puts the reason in the tooltip, where it
// costs no layout and is one hover or one focus away.
//
// What is NOT hidden: a failure. A refused transcription and a refused utterance
// still say so, from the route's machine CODE resolved in the reader's language,
// because a control that quietly did nothing is worse than a sentence.

/** Dictation: press to listen, press to stop. The transcript APPENDS to the
 *  draft and never sends — a mis-heard word must be fixable before it is a turn. */
export function ConsoleDictateGlyph({
  lang,
  disabled,
  onDictated,
}: {
  lang: string;
  disabled: boolean;
  onDictated: (text: string) => void;
}) {
  const t = useTranslations("library.tab.intake.glyph");
  const tIo = useTranslations("library.tab.intake.voiceIo");
  const tIntake = useTranslations("library.tab.intake");
  const resolveError = useErrorMessage();
  const dictation = useIntakeDictation({ lang, onDictated });

  if (dictation.unavailable) {
    return <IconAction icon={MicOff} label={t("dictateOff")} hint={tIo("dictateUnavailable")} tone="muted" disabled />;
  }
  const error = dictation.phase === "error" ? resolveError({ code: dictation.errorCode }, tIntake("error")) : null;
  return (
    <span className="flex items-center gap-1.5">
      <IconAction
        icon={dictation.listening ? Square : Mic}
        label={dictation.listening ? tIo("dictating") : t("dictate")}
        on={dictation.listening}
        toggle
        disabled={disabled || dictation.busy}
        onClick={dictation.toggle}
      />
      {/* An open microphone owes a continuously visible indicator, and a flat
          meter during speech is the only self-diagnosis a requestor has. Under
          reduced motion the same number stands in as text — the information
          survives the accommodation instead of the motion surviving it. */}
      {dictation.listening && dictation.metered ? (
        <>
          <span
            className="h-1.5 w-14 overflow-hidden rounded-full bg-stone-200 motion-reduce:hidden"
            role="progressbar"
            aria-label={tIo("dictating")}
            aria-valuenow={micLevelPercent(dictation.level)}
          >
            <span
              className="block h-full rounded-full bg-moss transition-[width] duration-100 motion-reduce:transition-none"
              style={{ width: `${micLevelPercent(dictation.level)}%` }}
            />
          </span>
          <span className="hidden text-sm tabular-nums text-steel motion-reduce:inline">
            {micLevelPercent(dictation.level)}%
          </span>
        </>
      ) : null}
      {error ? (
        <span className="text-sm text-red-700" role="status">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** Read-aloud, plus the standing opt-in beside it. Two controls, because they
 *  answer different questions: "say that again" and "say the next one too". */
export function ConsoleSpeakGlyphs({
  intakeId,
  lang,
  speakText,
  disabled,
}: {
  intakeId: string;
  lang: string;
  /** The agent's newest line, or null while a turn is in flight. */
  speakText: string | null;
  disabled: boolean;
}) {
  const t = useTranslations("library.tab.intake.glyph");
  const tIo = useTranslations("library.tab.intake.voiceIo");
  const tIntake = useTranslations("library.tab.intake");
  const resolveError = useErrorMessage();
  const speech = useIntakeSpeech({ speakText, lang, sessionKey: intakeId });

  if (speech.unavailable) {
    return <IconAction icon={VolumeX} label={t("speakOff")} hint={tIo("speakUnavailable")} tone="muted" disabled />;
  }
  const readable = speakText?.trim() ? speakText : null;
  const error = speech.playback === "error" ? resolveError({ code: speech.errorCode }, tIntake("error")) : null;
  return (
    <span className="flex items-center gap-0.5">
      {readable ? (
        <IconAction
          icon={speech.speaking ? Square : Volume2}
          label={speech.speaking ? tIo("speaking") : t("speak")}
          on={speech.speaking}
          toggle
          disabled={disabled}
          onClick={() => {
            if (speech.blocked) speech.resume();
            else if (speech.speaking) speech.stop();
            else speech.speak(readable);
          }}
        />
      ) : null}
      <IconAction
        icon={Radio}
        label={t("autoSpeak")}
        hint={tIo("autoSpeak")}
        on={speech.autoSpeak}
        toggle
        onClick={() => speech.setAutoSpeak(!speech.autoSpeak)}
      />
      {error ? (
        <span className="text-sm text-red-700" role="status">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The relay call, gated on its own availability probe.
 *
 * The driver itself (WebRTC transport, the orchestrator queue, barge-in, the
 * recovery post) is `JdsIntakeVoice` and stays exactly as it is — a coat is a
 * visual direction, not a second implementation of a voice plane. What this
 * wrapper owns is the ONE thing the coat disagrees with: an install with no
 * provider used to answer with two lines of prose inside the composer. Here the
 * probe happens first, and a machine that cannot call shows a hung-up phone with
 * the reason in its tooltip. `unknown` (the probe itself did not land) is not the
 * same claim as `unconfigured`, so it stays clickable — pressing re-probes.
 */
export function ConsoleCallGlyph({
  intakeId,
  disabled,
  transcript,
  onExchange,
  onSweep,
}: {
  intakeId: string;
  disabled: boolean;
  transcript: { role: string; text: string }[];
  onExchange: (intakeId: string, payload: { userText: string; reply: string; done: boolean; brief?: RoleBrief }) => void;
  onSweep: (intakeId: string, payload: VoiceSweepPayload) => void;
}) {
  const t = useTranslations("library.tab.intake.glyph");
  const tVoice = useTranslations("library.tab.intake.voice");
  const [availability, setAvailability] = useState<VoiceAvailability>("checking");
  const [probe, setProbe] = useState(0);

  useEffect(() => {
    // Deferred a tick (the jdsHooks.ts pattern) — no synchronous setState in an effect.
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/intake/${encodeURIComponent(intakeId)}/voice-connect`);
        setAvailability(readAvailability(res.ok, await res.json().catch(() => ({}))));
      } catch {
        /* the probe failed, which is a fact about the network and not about
           whether this install has a provider — say so, and stay re-askable */
        setAvailability("unknown");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [intakeId, probe]);

  if (availability === "ready") {
    return (
      <JdsIntakeVoice
        intakeId={intakeId}
        disabled={disabled}
        transcript={transcript}
        onExchange={onExchange}
        onSweep={onSweep}
      />
    );
  }
  return (
    <IconAction
      icon={PhoneOff}
      label={t("callOff")}
      hint={availability === "unconfigured" ? tVoice("unavailable") : tVoice("checkFailed")}
      tone="muted"
      disabled={availability !== "unknown"}
      onClick={() => setProbe((n) => n + 1)}
    />
  );
}
