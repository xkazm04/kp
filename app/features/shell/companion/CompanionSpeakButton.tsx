"use client";

import { useTranslations } from "next-intl";
import type { CompanionSpeech, CompanionSpeakableTurn } from "./useCompanionSpeech";

/*
 * The per-reply speak affordance (V1) — one small control in the marginalia
 * under an assistant bubble, beside the recall chips.
 *
 * It sits there rather than in the header or the composer because what it acts
 * on is THIS answer: a global "read the last reply" control cannot say which
 * reply it means once the operator has scrolled, and a header control would need
 * its own notion of "current turn" that the transcript already has.
 *
 * ONE BUTTON, THREE MEANINGS, never a fourth: start this reply, stop the one
 * that is playing, or unblock a playback the browser refused. The last is rare
 * from a click (a user gesture is what browsers want) and expected from V2's
 * auto-speak, so the state is handled here rather than left for a caller to
 * discover — `blocked` looks exactly like silence otherwise.
 *
 * NEVER A SILENT NO-OP. There is no availability probe on mount (see
 * useCompanionSpeech), so a machine with no engine configured is discovered by
 * pressing play: the route answers with a typed reason, and the failure is said
 * out here in words with the engine's own explanation on the control. The button
 * is not disabled afterwards — an operator who just pasted an API key is one
 * click from it working, and a control that latched off would be lying.
 */

export function CompanionSpeakButton({
  turn,
  speech,
}: {
  turn: CompanionSpeakableTurn;
  speech: CompanionSpeech;
}) {
  const t = useTranslations("companion");
  const active = speech.speakingId === turn.id;
  const blocked = active && speech.playback === "blocked";
  const failed = active && speech.playback === "error";
  const label = blocked ? t("voice.resume") : active && !failed ? t("voice.stop") : t("voice.speak");

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        aria-pressed={active && !failed}
        aria-label={label}
        title={failed && speech.error ? speech.error : label}
        onClick={() => {
          if (blocked) speech.resume();
          else if (active && !failed) speech.stop();
          else speech.speak(turn);
        }}
        className={`focus-ring inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors dark:inline-block dark:rotate-1 ${
          active && !failed
            ? "border-coral/40 bg-coral/10 text-coral"
            : "border-stone-200 text-steel hover:border-coral/40 hover:text-ink"
        }`}
      >
        <SpeakGlyph stopping={active && !failed && !blocked} />
      </button>
      {failed ? (
        <span className="text-sm text-coral" role="status">
          {t("voice.failed")}
        </span>
      ) : null}
    </span>
  );
}

/** A speaker, or a stop square while this reply is the one speaking. Inline SVG
 *  in `currentColor` so it inherits the button's own token color in both themes
 *  — no fill literal, nothing for the design gate to catch. */
function SpeakGlyph({ stopping }: { stopping: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden focusable="false">
      {stopping ? (
        <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
      ) : (
        <>
          <path d="M3 6.2h2.3L8.4 3.4v9.2L5.3 9.8H3z" fill="currentColor" />
          <path
            d="M10.6 5.6a3.4 3.4 0 0 1 0 4.8M12.6 3.6a6.2 6.2 0 0 1 0 8.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}
