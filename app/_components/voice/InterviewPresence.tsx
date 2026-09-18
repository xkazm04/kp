"use client";

// The focal point of a live call (spark ai-interview-parity).
//
// A voice interview has almost no visual surface: a transcript that arrives a beat
// late and a row of buttons. The candidate's eye has nowhere to rest, so the silence
// while the model thinks reads as a frozen page. This is the one element that is
// always saying something true about the call right now — and it says it in three
// registers at once, because each covers a gap the others leave:
//
//   SIGHT   the ring, which follows the live audio level (whose voice, how loud);
//   TEXT    a label under it, because a ring is not a state anyone can name;
//   SPEECH  an `aria-live` region carrying the SAME label, because none of the above
//           reaches a screen-reader user, for whom "is it my turn?" is the entire UI.
//
// MOTION. The ring follows the meter on its OWN animation frame, writing one CSS
// custom property — the level never passes through React, because a state update per
// frame would re-render the whole call shell sixty times a second to move one ring.
// Under `prefers-reduced-motion` the loop is never armed and the rings are static:
// the STATE is still fully legible (color, label, live region), only the pulsing is
// gone, which is the accommodation rather than a lesser version of it.
//
// THEME. Both registers come out of the token seam: Studio Light gets a calm
// concentric halo, Spark Dark gets the drawn outline and sticker shadow its siblings
// have. No JS fork — everything a theme changes here is a `dark:` variant.

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Ear, Loader2, Mic, PhoneOff, Sparkles } from "lucide-react";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { presenceMeter, type PresenceState } from "./presence-state";

/** Per-state skin: the ring's color, the halo's, and the glyph. Tokens only — each
 *  resolves through `[data-theme="dark"]` in globals.css. */
const SKIN: Record<PresenceState, { ring: string; halo: string; text: string; Icon: typeof Mic }> = {
  idle: { ring: "border-stone-300", halo: "bg-stone-200", text: "text-steel", Icon: Mic },
  connecting: { ring: "border-dial-amber", halo: "bg-dial-amber", text: "text-ink", Icon: Loader2 },
  listening: { ring: "border-moss", halo: "bg-moss", text: "text-moss", Icon: Ear },
  thinking: { ring: "border-steel", halo: "bg-steel", text: "text-steel", Icon: Loader2 },
  speaking: { ring: "border-coral", halo: "bg-coral", text: "text-coral", Icon: Sparkles },
  ended: { ring: "border-stone-300", halo: "bg-stone-200", text: "text-steel", Icon: PhoneOff },
};

export function InterviewPresence({
  state,
  levels,
  className = "",
}: {
  state: PresenceState;
  /** The shared level box the transports write (0..1 per channel). Read on our own
   *  frame; never rendered. */
  levels: { current: { input: number; output: number } };
  className?: string;
}) {
  const t = useTranslations("interview.voice.presence");
  const reduced = useReducedMotion();
  const haloRef = useRef<HTMLSpanElement | null>(null);
  const meter = presenceMeter(state);

  useEffect(() => {
    const el = haloRef.current;
    // No meter for this state, no motion preference for animation, or no element:
    // the halo keeps its CSS resting size and nothing loops.
    if (!el || meter === null || reduced) {
      el?.style.removeProperty("--presence-level");
      return;
    }
    let raf = 0;
    // Smoothed, because a raw RMS jitters at frame rate and reads as a fault rather
    // than as a voice. Fast attack, slow release — the same shape a level meter has.
    let shown = 0;
    const tick = () => {
      const raw = meter === "input" ? levels.current.input : levels.current.output;
      const target = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
      shown += (target - shown) * (target > shown ? 0.45 : 0.12);
      el.style.setProperty("--presence-level", shown.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      el.style.removeProperty("--presence-level");
    };
  }, [meter, reduced, levels]);

  const skin = SKIN[state];
  const label = t(state);
  const spinning = (state === "connecting" || state === "thinking") && !reduced;

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <div className="relative grid h-32 w-32 place-items-center sm:h-36 sm:w-36">
        {/* The halo: one element, scaled by the level through a custom property the
            RAF loop writes. Its resting scale is what a static (reduced-motion or
            non-audio) state shows, so the accommodation is a missing animation, not
            a missing element. */}
        <span
          ref={haloRef}
          aria-hidden
          className={`voice-presence-halo absolute inset-0 rounded-full opacity-20 ${skin.halo}`}
        />
        <span
          aria-hidden
          className={`absolute inset-2 rounded-full border-2 opacity-40 ${skin.ring} dark:border-[3px]`}
        />
        <span
          aria-hidden
          className={`relative grid h-20 w-20 place-items-center rounded-full border-2 bg-white ${skin.ring} shadow-panel dark:shadow-sticker-sm sm:h-24 sm:w-24`}
        >
          <skin.Icon size={28} className={`${skin.text} ${spinning ? "animate-spin" : ""}`} />
        </span>
      </div>
      {/* ONE live region for the state, and the visible label is the same string —
          a sighted and a screen-reader candidate are told the same thing. `polite`
          because the transitions are conversational turns, not alarms. */}
      <p role="status" aria-live="polite" className={`text-meta uppercase ${skin.text}`}>
        {label}
      </p>
    </div>
  );
}
