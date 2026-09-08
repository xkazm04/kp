"use client";

// The keyless voice pair for the intake composer: push-to-talk dictation
// (/api/stt) and read-aloud of the agent's turn (/api/tts). This file is the
// WIRE between the studio (which mounts it in the composer slot) and the voice
// package (which fills it in): the props below are the contract, and a host
// may render it before the implementation lands — it draws nothing until then.
export type IntakeVoiceBarProps = {
  intakeId: string;
  lang: string;
  /** Dictated text APPENDS to the composer draft; it never sends. */
  onDictated: (text: string) => void;
  /** The agent text the speak control reads; null when there is nothing to read. */
  speakText: string | null;
  disabled?: boolean;
};

export function IntakeVoiceBar(_props: IntakeVoiceBarProps) {
  return null;
}
