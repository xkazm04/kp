"use client";

import { useTranslations } from "next-intl";
import { Clock, Mic, MicOff, Volume2, VolumeX } from "lucide-react";

/** The live-call-only half of the controls row: M4 mic mute, the AI-output mute,
 *  the M3 elapsed timer and the autoplay-blocked recovery. Rendered as a fragment
 *  inside the caller's `aria-busy` controls block, in the same order as before, so
 *  the blocked-audio button stays announced with the rest of the controls. */
export function VoiceLiveControls({
  muted,
  onToggleMute,
  audioMuted,
  onToggleAudioMuted,
  elapsed,
  unstable,
  audioBlocked,
  onEnableAudio,
}: {
  muted: boolean;
  onToggleMute: () => void;
  audioMuted: boolean;
  onToggleAudioMuted: () => void;
  elapsed: number;
  unstable: boolean;
  audioBlocked: boolean;
  onEnableAudio: () => void;
}) {
  const t = useTranslations("interview.voice");
  return (
    <>
      <button
        type="button"
        onClick={onToggleMute}
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
        onClick={onToggleAudioMuted}
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
      {/* bug-ui-scan-2026-07-09 (voice-interview #4): autoplay-blocked recovery —
          inside the aria-busy controls block so it's announced. */}
      {audioBlocked ? (
        <button
          type="button"
          onClick={onEnableAudio}
          className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-md border border-dial-amber/50 bg-dial-amber/10 px-4 text-base font-semibold text-ink transition-colors hover:bg-dial-amber/20"
        >
          <Volume2 size={18} />
          {t("enableAudio")}
        </button>
      ) : null}
    </>
  );
}
