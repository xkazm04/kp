"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { BTN_GHOST } from "@/app/_components/ui/recipes";
import { useSceneTransport } from "../stage/useSceneClock";
import type { ClockShape, TransportState } from "../stage/transport";

/*
 * Pieces every scene repeats, hoisted the moment a second chapter needed them.
 *
 * The status line is part of the deck's contract, not decoration: each scene
 * carries exactly ONE line of monospace text under the field, phase-mapped,
 * naming what the machine is doing in its own vocabulary. The picture carries
 * the shape of the mechanism; the line carries the identifier a sceptical
 * reader could go and grep for. Keeping it to one line is what stops these
 * scenes from growing captions that explain the animation instead of the
 * mechanism.
 */

/**
 * The phase → text lookup, re-exported so scenes keep one import.
 *
 * It moved to `scenes/status.ts` when it earned a test: it is pure, six scenes
 * depend on it, and the node test runner cannot load a TSX file. Everything
 * else in this file needs React, which is why only this one left.
 */
export { statusPicker } from "./status";

/**
 * The status line itself.
 *
 * Crossfades on change via a CSS transition on a keyed span rather than
 * `AnimatePresence`: the text is replaced in place, nothing needs to animate
 * out, and a JS presence wrapper here would be a third animation system in a
 * scene that already has two.
 *
 * The OUTER `p` is the live region, mounted from beat 0 (every scene always
 * renders SceneStatus). A region that arrives together with its first content
 * is announced by nothing — the trap CompanionVoiceTicker already documents —
 * so aria-live sits here, not on the keyed inner span. `aria-atomic` makes
 * each swap read as the new identifier, not a diff. Reduced motion pins
 * stillTick, so the region speaks once; a reader who stops the scene with the
 * transport beside it holds the line the same way.
 */
export function SceneStatus({ phase, text, reduced }: { phase: number; text: string; reduced: boolean }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p className="min-h-[1.5rem] min-w-0 font-mono text-meta text-steel" aria-live="polite" aria-atomic="true">
        <span
          key={text}
          className="inline-block"
          style={{
            animation: reduced ? undefined : "fade-in 320ms ease-out both",
          }}
        >
          {text}
        </span>
      </p>
      <SceneTransport phase={phase} reduced={reduced} />
    </div>
  );
}

const NO_SUBSCRIBE = () => () => {};
const NO_STATE = (): TransportState | null => null;
const NO_CLOCK = (): ClockShape | null => null;
const TRANSPORT_BTN = `${BTN_GHOST} h-8 w-8 justify-center`;

/**
 * The reader's controls for this scene's loop (`stage/transport.ts`): step
 * back, stop/play, step forward, and a beat scrubber.
 *
 * Deliberately OUTSIDE the live region: the beat counter changes every 900ms
 * while playing, and announcing it would drown the status line it sits beside.
 * The scrubber's `aria-valuetext` says the position when the reader asks.
 *
 * Under OS reduced motion there is no Play: nothing animates for those readers
 * in any state, so a Play button would be a control that does nothing. Step and
 * scrub stay, because holding a chosen beat is not motion.
 *
 * Renders nothing outside a transport (before the scene binds its clock, or a
 * scene mounted somewhere without a deck), so SSR HTML carries no dead buttons.
 */
function SceneTransport({ phase, reduced }: { phase: number; reduced: boolean }) {
  const t = useTranslations("about.transport");
  const store = useSceneTransport();
  const state = useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIBE, store?.getSnapshot ?? NO_STATE, NO_STATE);
  const clock = useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIBE, store?.getClock ?? NO_CLOCK, NO_CLOCK);
  if (!store || !state || !clock) return null;

  const playing = state.user === "auto" && !reduced;
  return (
    <div role="group" aria-label={t("group")} className="flex shrink-0 items-center gap-1">
      <button type="button" aria-label={t("back")} title={t("back")} onClick={() => store.step(-1)} className={TRANSPORT_BTN}>
        <ChevronLeft size={15} aria-hidden />
      </button>
      {reduced ? null : (
        <button
          type="button"
          aria-label={playing ? t("stop") : t("play")}
          title={playing ? t("stop") : t("play")}
          onClick={() => (playing ? store.stop() : store.play())}
          className={TRANSPORT_BTN}
        >
          {playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
        </button>
      )}
      <button type="button" aria-label={t("forward")} title={t("forward")} onClick={() => store.step(1)} className={TRANSPORT_BTN}>
        <ChevronRight size={15} aria-hidden />
      </button>
      <input
        type="range"
        aria-label={t("scrub")}
        aria-valuetext={t("position", { n: phase + 1, total: clock.cycle })}
        min={0}
        max={Math.max(0, clock.cycle - 1)}
        step={1}
        value={phase}
        onChange={(e) => store.seek(Number(e.currentTarget.value))}
        className="focus-ring ml-1 w-24 accent-coral sm:w-32"
      />
      <span className="nums w-10 text-right font-mono text-meta text-steel" aria-hidden>
        {phase + 1}/{clock.cycle}
      </span>
    </div>
  );
}

/** A lane's human name — uppercase tracking reads as a section marker. */
export function LaneLabel({ children }: { children: ReactNode }) {
  return <p className="text-meta uppercase tracking-wide text-steel">{children}</p>;
}

/**
 * A lane labelled by its real code identifier.
 *
 * Deliberately NOT uppercased: `statedVsRealGaps` shouted as STATEDVSREALGAPS
 * loses the camel case that makes it greppable, which is the only reason to
 * print an identifier at all.
 *
 * The identifier arrives as the `code` PROP rather than as children, and that
 * is a statement about localization rather than a styling choice. These strings
 * are function and column names in the running code; they are Do-Not-Translate
 * by the same rule that protects product nouns and ICU placeholders, and
 * putting them in the message catalog would invite four translators to render
 * `ko_filter()` four different ways. Passing them as a prop keeps them out of
 * the catalog and out of the i18n linter's path at the same time.
 *
 * `children` stays available for the rare label that IS prose and should come
 * from `t()`.
 */
export function CodeLabel({ code, children }: { code?: string; children?: ReactNode }) {
  return <p className="truncate font-mono text-meta text-steel">{code ?? children}</p>;
}

/**
 * A weight/score bar that grows from its left edge.
 *
 * CSS, not framer: these appear a dozen at a time inside scenes that re-render
 * every 900ms, and a JS-driven animation per bar is both wasteful and — as the
 * chapter-1 cascade bug showed — fragile under that much re-rendering.
 */
export function Bar({
  value,
  shown,
  reduced,
  tone = "moss",
  className = "",
}: {
  /** 0..1 */
  value: number;
  shown: boolean;
  reduced: boolean;
  tone?: "moss" | "amber" | "coral" | "steel";
  className?: string;
}) {
  const fill = {
    moss: "bg-moss",
    amber: "bg-dial-amber",
    coral: "bg-coral",
    steel: "bg-steel",
  }[tone];
  return (
    <span className={`block h-1.5 overflow-hidden rounded-full bg-stone-100 ${className}`}>
      <span
        className={`block h-full rounded-full ${fill}`}
        style={{
          width: shown ? `${Math.round(value * 100)}%` : "0%",
          transition: reduced ? "none" : "width 560ms cubic-bezier(0.16,1,0.3,1)",
        }}
      />
    </span>
  );
}
