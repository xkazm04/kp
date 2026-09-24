"use client";

import { useTranslations } from "next-intl";
import type { Phase } from "./ui-types";

export function StatusPill({
  phase,
  speaking,
  unstable,
  thinking,
}: {
  phase: Phase;
  speaking: boolean;
  unstable?: boolean;
  /** The model is generating but has not started speaking (spark
   *  ai-interview-parity). Until this state existed the pill read "Listening" while
   *  the interviewer was composing a question — i.e. it told the candidate it was
   *  their turn at precisely the moment it was not, which is how people end up
   *  talking over the interviewer's first word. */
  thinking?: boolean;
}) {
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
  // Thinking sits between the two live states and must not be painted as either: a
  // steel pill with the same breathing dot, so it reads as "hold on" rather than as
  // "your turn" (moss) or "I am talking" (the bars).
  if (phase === "live" && thinking && !speaking) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-stone-100 px-3 py-1 text-meta text-steel">
        <span className="voice-listen h-2.5 w-2.5 rounded-full bg-steel" aria-hidden />
        {t("status.thinking")}
      </span>
    );
  }
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
