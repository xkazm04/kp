"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import { mkRootOf } from "../chrome/rootState";
import { PlaneGlyph } from "./art/HeroArt";

/*
 * The hero's behaviour (the prototype's app.js "intro" and "hero" blocks):
 *
 *   - the intro: the root starts at data-intro="run" (MkRoot) and a few beats
 *     play; any pointer, key, wheel or touch ends it at once, and it ends by
 *     itself after 3.8 s (at once under reduced motion);
 *   - the autopilot switch: 1.7 s in (unless the visitor already touched it) it
 *     flips on, a paper plane leaves the knob for the pile and the three sample
 *     CVs are scored one by one; the pass on Alex T. then waits for a human;
 *   - the pointer parallax (--mx/--my) and the hills' scroll drift (--sy).
 *
 * HeroShell owns the state and renders the <section>; AutoPill and HeroPile read
 * it from context. Everything else in the hero is server-rendered copy and art.
 * Reduced motion: the switch starts on, fully scored, with no plane and no intro.
 */

type HeroState = {
  auto: boolean;
  launched: boolean;
  /** How many of the three cards carry their stamp. */
  scored: number;
  signed: boolean;
  toggle: () => void;
  sign: () => void;
};

const HeroContext = createContext<HeroState | null>(null);

function useHero(): HeroState {
  const ctx = useContext(HeroContext);
  if (!ctx) throw new Error("AutoPill and HeroPile render inside HeroShell");
  return ctx;
}

const REDUCE = "(prefers-reduced-motion: reduce)";
const MOBILE = "(max-width: 1099px), (max-aspect-ratio: 5/4)";
const CARD_COUNT = 3;

/** The plane's flight from the knob to the pile: a quadratic curve, turned along its tangent. */
function flyPlane(hero: HTMLElement) {
  if (window.matchMedia(REDUCE).matches || window.matchMedia(MOBILE).matches) return;
  const knob = hero.querySelector<HTMLElement>(".knob");
  const stage = hero.querySelector<HTMLElement>(".stage");
  const pile = hero.querySelector<HTMLElement>(".pile");
  const svg = knob?.querySelector("svg");
  if (!knob || !stage || !pile || !svg || typeof stage.animate !== "function") return;
  const sr = stage.getBoundingClientRect();
  const k = knob.getBoundingClientRect();
  const p = pile.getBoundingClientRect();
  const x0 = k.left + k.width / 2 - sr.left;
  const y0 = k.top + k.height / 2 - sr.top;
  const x1 = p.left + p.width * 0.16 - sr.left;
  const y1 = p.top + p.height * 0.1 - sr.top;
  const cx = (x0 + x1) / 2 - (x1 - x0) * 0.15;
  const cy = Math.min(y0, y1) - sr.height * 0.22;
  const el = document.createElement("div");
  el.className = "plane-fly";
  el.setAttribute("aria-hidden", "true");
  el.appendChild(svg.cloneNode(true));
  stage.appendChild(el);
  const frames: Keyframe[] = [];
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1;
    const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1;
    const dx = 2 * (1 - t) * (cx - x0) + 2 * t * (x1 - cx);
    const dy = 2 * (1 - t) * (cy - y0) + 2 * t * (y1 - cy);
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI + 45;
    frames.push({
      transform: `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%) rotate(${ang.toFixed(1)}deg) scale(${(1.25 - 0.55 * t).toFixed(2)})`,
      opacity: t > 0.9 ? 0 : 1,
      offset: t
    });
  }
  const an = el.animate(frames, { duration: 1150, easing: "cubic-bezier(.45,0,.3,1)" });
  an.onfinish = () => el.remove();
  an.oncancel = () => el.remove();
}

export function HeroShell({
  labelledBy,
  live,
  children
}: {
  labelledBy: string;
  /** The polite status lines, already translated. */
  live: { on: string; off: string; signed: string };
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [auto, setAutoState] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [scored, setScored] = useState(0);
  const [signed, setSigned] = useState(false);
  const [liveText, setLiveText] = useState("");
  const timers = useRef<number[]>([]);
  const autoRef = useRef(false);
  const touched = useRef(false);

  const setAuto = useCallback(
    (on: boolean, instant: boolean) => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
      const later = (fn: () => void, ms: number) => {
        timers.current.push(window.setTimeout(fn, ms));
      };
      autoRef.current = on;
      setAutoState(on);
      if (!on) {
        setScored(0);
        setSigned(false);
        setLaunched(false);
        setLiveText(live.off);
        return;
      }
      if (instant) {
        setScored(CARD_COUNT);
        setLiveText(live.on);
        return;
      }
      later(() => {
        setLaunched(true);
        if (ref.current) flyPlane(ref.current);
        later(() => setLaunched(false), 1300);
      }, 440);
      for (let i = 0; i < CARD_COUNT; i++) later(() => setScored(i + 1), 650 + i * 620);
      later(() => setLiveText(live.on), 650 + CARD_COUNT * 620);
    },
    [live.on, live.off]
  );

  useEffect(() => {
    const hero = ref.current;
    if (!hero) return;
    const reduced = window.matchMedia(REDUCE).matches;

    // intro: a few beats, skippable by any input, never blocking control
    const root = mkRootOf(hero);
    const endIntro = () => root?.setAttribute("data-intro", "done");
    const INPUTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    INPUTS.forEach((ev) => window.addEventListener(ev, endIntro, { once: true, passive: true }));
    const introT = window.setTimeout(endIntro, reduced ? 0 : 3800);

    // the switch flips itself on, unless the visitor got there first
    const autoT = window.setTimeout(
      () => {
        if (!touched.current) setAuto(true, reduced);
      },
      reduced ? 0 : 1700
    );

    // pointer parallax
    const onMove = (e: PointerEvent) => {
      const r = hero.getBoundingClientRect();
      hero.style.setProperty("--mx", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
      hero.style.setProperty("--my", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
    };
    if (!reduced) hero.addEventListener("pointermove", onMove);

    // the hills drift with the scroll while the hero is in reach
    let frame = 0;
    const paintScroll = () => {
      frame = 0;
      const y = window.scrollY;
      if (y < window.innerHeight * 1.3) hero.style.setProperty("--sy", String(y));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(paintScroll);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    paintScroll();

    const pending = timers;
    return () => {
      INPUTS.forEach((ev) => window.removeEventListener(ev, endIntro));
      window.clearTimeout(introT);
      window.clearTimeout(autoT);
      hero.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      pending.current.forEach((id) => window.clearTimeout(id));
      pending.current = [];
    };
  }, [setAuto]);

  const value = useMemo<HeroState>(
    () => ({
      auto,
      launched,
      scored,
      signed,
      toggle: () => {
        touched.current = true;
        setAuto(!autoRef.current, false);
      },
      sign: () => {
        setSigned(true);
        setLiveText(live.signed);
      }
    }),
    [auto, launched, scored, signed, setAuto, live.signed]
  );

  return (
    <HeroContext.Provider value={value}>
      <section ref={ref} className="hero" id="top" data-auto={auto ? "on" : "off"} aria-labelledby={labelledBy}>
        {children}
        <p className="sr-only" role="status" aria-live="polite">
          {liveText}
        </p>
      </section>
    </HeroContext.Provider>
  );
}

/** "autopilot": the headline's pill, a real switch. */
export function AutoPill({ children }: { children: ReactNode }) {
  const { auto, launched, toggle } = useHero();
  return (
    <button
      type="button"
      className={launched ? "pill launched" : "pill"}
      role="switch"
      aria-checked={auto}
      aria-describedby="autoNote"
      onClick={toggle}
    >
      <span className="pill-word">{children}</span>
      <span className="knob" aria-hidden="true">
        <PlaneGlyph />
      </span>
    </button>
  );
}

export type PileCardData = {
  key: "jana" | "petr" | "alex";
  name: string;
  role: string;
  verdict: string;
  score: number;
  tone: string;
};

/** The three sample CVs. Scored by the switch; a hovered or focused card peeks
 *  at its stamp while the switch is off. The pass on Alex T. waits for a human. */
export function HeroPile({
  label,
  cards,
  waiting,
  signLabel,
  signedLabel
}: {
  label: string;
  cards: readonly PileCardData[];
  waiting: string;
  signLabel: string;
  signedLabel: string;
}) {
  const { auto, scored, signed, sign } = useHero();
  const [peek, setPeek] = useState<string | null>(null);
  return (
    <div className="pile" id="pile" role="group" aria-label={label}>
      <span className="cv blank b1" aria-hidden="true" />
      <span className="cv blank b2" aria-hidden="true" />
      <span className="cv blank b3" aria-hidden="true" />
      {cards.map((card, i) => {
        const classes = ["cv", `c-${card.key}`];
        if (i < scored) classes.push("scored");
        if (card.key === "alex" && signed) classes.push("done");
        if (peek === card.key && !auto) classes.push("peek");
        const look = () => setPeek(card.key);
        const unlook = () => setPeek((p) => (p === card.key ? null : p));
        return (
          <article
            key={card.key}
            className={classes.join(" ")}
            tabIndex={0}
            style={{ "--tone": card.tone } as CSSProperties}
            onPointerEnter={look}
            onPointerLeave={unlook}
            onFocus={look}
            onBlur={unlook}
          >
            <h3>{card.name}</h3>
            <p className="role">{card.role}</p>
            <i className="ln" />
            <i className="ln s" />
            <i className="ln xs" />
            <span className="stamp">{card.score}</span>
            <b className="verdict">{card.verdict}</b>
            {card.key === "alex" ? (
              <>
                <span className="wait">{waiting}</span>
                <button className="sign" type="button" onClick={sign}>
                  {signLabel}
                </button>
                <span className="signed">{signedLabel}</span>
              </>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
