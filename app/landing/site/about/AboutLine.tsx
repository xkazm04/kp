"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { useTranslations } from "next-intl";
import Stepper from "../chrome/Stepper";
import { mkRootOf } from "../chrome/rootState";
import { DIO_ENTER } from "./art/dio";
import {
  MOBILE_QUERY,
  OVERVIEW_PAINT,
  REDUCED_QUERY,
  SAMPLE,
  STEP_COUNT as N,
  STEP_KEYS,
  STEP_PAINT,
  pad2,
  stepName
} from "./steps";

/*
 * THE LINE's behaviour (the prototype's about/about.js), as one client island that wraps <main>:
 *   - the ribbon: ONE path through the jack under the hero LCD, the eight step nodes and the finale's seal, drawn as far
 *     as the reader has scrolled (ink tube, paper rim, colour core, dotted track ahead), with the "J" pawn at its tip;
 *   - which gates the tip has reached, which step is current (scroll-spy), the page colour (--sc on the site root);
 *   - the human gates: signing one lights its node, feeds the receipts tape, marks the stepper dot and the LCD station;
 *   - the bottom stepper (click to scroll), Replay, the arrival choreography (is-near / is-in + DIO_ENTER), the short
 *     skippable intro, the reduced-motion calm version (`reduced` on the root: the whole line drawn, every gate waiting).
 * Scroll-rate work (the ribbon and the pawn) writes to the DOM through refs; React state changes only when a gate is
 * reached or signed, or the current step changes. The step sections, copy and drawings are server-rendered children.
 */

export type LineTarget = number | "map" | "end";

type LineState = {
  names: readonly string[];
  signed: readonly boolean[];
  reached: readonly boolean[];
  /** The step signed last (its receipt feeds in), -1 before any. */
  just: number;
  /** -1 overview, 0..N-1 a step, N the finale. */
  cur: number;
  sign: (i: number) => void;
  goTo: (target: LineTarget) => void;
  replay: (i: number) => void;
};

const LineContext = createContext<LineState | null>(null);

export function useLine(): LineState {
  const line = useContext(LineContext);
  if (!line) throw new Error("useLine() outside <AboutLine>");
  return line;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const SVG_NS = "http://www.w3.org/2000/svg";

type Pt = { x: number; y: number };

export default function AboutLine({ lead, children }: { lead?: ReactNode; children: ReactNode }) {
  const t = useTranslations("siteAbout");
  const ta = useTranslations("aboutPage");
  const names = useMemo(() => STEP_KEYS.map((key) => stepName(ta(`steps.${key}.eyebrow`))), [ta]);

  const [signed, setSigned] = useState<readonly boolean[]>(() => STEP_KEYS.map(() => false));
  const [reached, setReached] = useState<readonly boolean[]>(() => STEP_KEYS.map(() => false));
  const [just, setJust] = useState(-1);
  const [cur, setCur] = useState(-1);

  const mainRef = useRef<HTMLElement>(null);
  const cableRef = useRef<SVGSVGElement>(null);
  const cableTopRef = useRef<SVGSVGElement>(null);
  const gradRef = useRef<SVGLinearGradientElement>(null);
  const bodyRef = useRef<SVGPathElement>(null);
  const inkRef = useRef<SVGPathElement>(null);
  const rimRef = useRef<SVGPathElement>(null);
  const trackRef = useRef<SVGPathElement>(null);
  const plugRef = useRef<SVGGElement>(null);
  const pawnLabRef = useRef<SVGGElement>(null);
  const pawnBgRef = useRef<SVGRectElement>(null);
  const pawnTxRef = useRef<SVGTextElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  /** The pawn label's width and the side its step prefers; the plug's x in the viewport (written by the scroll loop). */
  const pawnGeom = useRef({ w: 0, preferLeft: false, x: -1, bx: Number.NaN });

  /*
   * Places the pawn's label beside the plug: on the side the step's drawing is on, so it never covers the copy, unless
   * that side has no room on this screen (on a phone the cable runs near the left edge and a left label was drawn
   * entirely off-screen); then the other side, and as the last resort it is held inside the viewport.
   */
  const placePawnLabel = useCallback(() => {
    const bg = pawnBgRef.current;
    const tx = pawnTxRef.current;
    const g = pawnGeom.current;
    if (!bg || !tx || !g.w || g.x < 0) return;
    const M = 6;
    const vw = document.documentElement.clientWidth;
    const fitsLeft = g.x - 27 - g.w >= M;
    const fitsRight = g.x + 27 + g.w <= vw - M;
    const left = g.preferLeft ? fitsLeft || !fitsRight : !fitsRight && fitsLeft;
    const bx = Math.round(Math.max(M - g.x, Math.min(left ? -(27 + g.w) : 27, vw - M - g.x - g.w)));
    if (bx === g.bx) return;
    g.bx = bx;
    bg.setAttribute("x", String(bx));
    tx.setAttribute("x", String(bx + 13));
  }, []);
  const placePawnRef = useRef(placePawnLabel);

  // mutable mirrors the scroll loop reads without re-subscribing
  const signedRef = useRef<boolean[]>(STEP_KEYS.map(() => false));
  const reachedRef = useRef<boolean[]>(STEP_KEYS.map(() => false));
  const curRef = useRef(-2);
  const sectionsRef = useRef<HTMLElement[]>([]);
  const diosRef = useRef<(HTMLElement | null)[]>([]);
  const announceTimer = useRef(0);

  const announce = useCallback((msg: string) => {
    const el = liveRef.current;
    if (!el) return;
    el.textContent = "";
    window.clearTimeout(announceTimer.current);
    announceTimer.current = window.setTimeout(() => {
      el.textContent = msg;
    }, 40);
  }, []);

  const kandiMood = useCallback((id: string) => {
    const root = mkRootOf(mainRef.current);
    const el = root?.querySelector<HTMLElement>(`#${id}`);
    if (!el || window.matchMedia(REDUCED_QUERY).matches) return;
    el.dataset.mood = "idle";
    void el.offsetWidth;
    el.dataset.mood = "cheer";
    window.setTimeout(() => {
      el.dataset.mood = "idle";
    }, 1100);
  }, []);

  const sign = useCallback(
    (i: number) => {
      if (signedRef.current[i]) {
        announce(t("announce.already", { n: i + 1 }));
        return;
      }
      signedRef.current[i] = true;
      reachedRef.current[i] = true;
      setSigned([...signedRef.current]);
      setReached([...reachedRef.current]);
      setJust(i);
      announce(t("announce.signed", { n: i + 1, name: names[i], signer: SAMPLE.signer }));
      const all = signedRef.current.every(Boolean);
      kandiMood("kandi2");
      if (all) {
        kandiMood("kandi");
        announce(t("announce.all"));
      }
    },
    [announce, kandiMood, names, t]
  );

  const goTo = useCallback((target: LineTarget) => {
    const main = mainRef.current;
    if (!main) return;
    const root = mkRootOf(main);
    const reduced = window.matchMedia(REDUCED_QUERY).matches;
    const mobile = window.matchMedia(MOBILE_QUERY).matches;
    const behavior: ScrollBehavior = reduced ? "auto" : "smooth";
    if (target === "map" || (typeof target === "number" && target < 0)) {
      window.scrollTo({ top: 0, behavior });
      return;
    }
    const toEnd = target === "end" || target >= N;
    const el = toEnd ? root?.querySelector<HTMLElement>("#end") : sectionsRef.current[target];
    if (!el) return;
    el.scrollIntoView({ behavior, block: mobile ? "start" : toEnd ? "end" : "center" });
    if (typeof target === "number" && target >= 0 && target < N) {
      try {
        history.replaceState(history.state, "", `#${el.id}`);
      } catch {
        /* history is optional: the scroll already happened */
      }
    }
  }, []);

  const replay = useCallback(
    (i: number) => {
      const dio = diosRef.current[i];
      if (!dio) return;
      dio.classList.remove("is-in");
      void dio.offsetWidth;
      window.setTimeout(() => {
        dio.classList.add("is-in");
        dio.dispatchEvent(new CustomEvent(DIO_ENTER, { bubbles: true }));
      }, 60);
      announce(t("replay.done", { name: names[i] }));
    },
    [announce, names, t]
  );

  /* ---------- the ribbon, scroll-spy, arrival, intro: one effect for the page's life ---------- */
  useEffect(() => {
    const main = mainRef.current;
    const svg = cableRef.current;
    const svgTop = cableTopRef.current;
    const grad = gradRef.current;
    const pBody = bodyRef.current;
    const plug = plugRef.current;
    const root = mkRootOf(main);
    if (!main || !svg || !svgTop || !grad || !pBody || !plug || !root) return;
    const paths = [bodyRef.current, inkRef.current, rimRef.current, trackRef.current].filter(
      (p): p is SVGPathElement => p !== null
    );
    const drawn = [bodyRef.current, inkRef.current, rimRef.current].filter((p): p is SVGPathElement => p !== null);

    const sections = Array.from(main.querySelectorAll<HTMLElement>("section.step"));
    sectionsRef.current = sections;
    diosRef.current = sections.map((s) => s.querySelector<HTMLElement>(".dio"));
    const plates = sections.map((s) => s.querySelector<HTMLElement>(".nd-disc"));
    const jackStart = root.querySelector<HTMLElement>("#jackStart");
    const jackEnd = root.querySelector<HTMLElement>("#jackEnd");

    const RM = window.matchMedia(REDUCED_QUERY);
    const MOB = window.matchMedia(MOBILE_QUERY);
    const reduced = () => RM.matches;
    const unitPx = () => (MOB.matches ? 16 : Math.min(window.innerWidth * 0.01, window.innerHeight * 0.016667));

    let total = 0;
    let ys: number[] = [];
    let ls: number[] = [];
    let nodeYs: number[] = [];
    let mainTop = 0;
    let mainLeft = 0;
    let stubLen = 0;
    let introL = 0;
    let raf = 0;

    const center = (el: Element, mr: DOMRect): Pt => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2 - mr.left, y: r.top + r.height / 2 - mr.top };
    };

    function layout() {
      if (!main || !svg || !svgTop || !grad || !pBody || !jackStart || !jackEnd) return;
      if (plates.some((p) => !p)) return;
      const mr = main.getBoundingClientRect();
      const u = unitPx();
      const W = Math.round(mr.width);
      const H = Math.round(mr.height);
      for (const s of [svg, svgTop]) {
        s.setAttribute("width", String(W));
        s.setAttribute("height", String(H));
        s.style.height = `${H}px`;
      }
      mainTop = mr.top + window.scrollY;
      mainLeft = mr.left + window.scrollX;
      const P: Pt[] = [center(jackStart, mr), ...plates.map((p) => center(p as HTMLElement, mr)), center(jackEnd, mr)];
      const mob = MOB.matches;
      const d = mob ? 0 : 4.3 * u;
      let dstr = `M${P[0].x.toFixed(1)} ${P[0].y.toFixed(1)}`;
      for (let i = 0; i < P.length - 1; i++) {
        const p = P[i];
        const q = P[i + 1];
        const dy = q.y - p.y;
        const sg = i % 2 === 0 ? 1 : -1;
        let c1: Pt;
        let c2: Pt;
        if (i === 0) {
          c1 = { x: p.x, y: p.y + dy * 0.32 };
          c2 = { x: q.x + (mob ? 0 : d), y: q.y - dy * 0.36 };
        } else if (i === P.length - 2) {
          c1 = { x: p.x + sg * d, y: p.y + dy * 0.34 };
          c2 = { x: q.x - (mob ? 0 : 7 * u), y: q.y };
          if (mob) {
            c1 = { x: p.x, y: p.y + dy * 0.4 };
            c2 = { x: q.x - 2 * u, y: q.y - 1 };
          }
        } else {
          c1 = { x: p.x + sg * d, y: p.y + dy * 0.36 };
          c2 = { x: q.x + sg * d, y: q.y - dy * 0.36 };
        }
        dstr += `C${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
      }
      for (const p of paths) p.setAttribute("d", dstr);
      total = pBody.getTotalLength();
      ys = [];
      ls = [];
      const n = Math.max(40, Math.ceil(total / 14));
      for (let k = 0; k <= n; k++) {
        const L = (total * k) / n;
        ys.push(pBody.getPointAtLength(L).y);
        ls.push(L);
      }
      nodeYs = P.slice(1, -1).map((p) => p.y);
      stubLen = 4.6 * u;
      const y0 = P[0].y;
      const y1 = P[P.length - 1].y;
      grad.setAttribute("y1", String(y0));
      grad.setAttribute("y2", String(y1));
      const stops: [number, string][] = [
        [0, STEP_PAINT[STEP_KEYS[0]].color],
        ...STEP_KEYS.map((key, i): [number, string] => [clamp((nodeYs[i] - y0) / (y1 - y0), 0, 1), STEP_PAINT[key].hi]),
        [1, STEP_PAINT[STEP_KEYS[N - 1]].hi]
      ];
      grad.replaceChildren(
        ...stops.map(([offset, color]) => {
          const s = document.createElementNS(SVG_NS, "stop");
          s.setAttribute("offset", offset.toFixed(4));
          s.setAttribute("stop-color", color);
          return s;
        })
      );
    }

    function lenAtY(y: number): number {
      if (!ys.length || y <= ys[0]) return 0;
      if (y >= ys[ys.length - 1]) return total;
      let lo = 0;
      let hi = ys.length - 1;
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (ys[m] <= y) lo = m;
        else hi = m;
      }
      const k = (y - ys[lo]) / Math.max(0.001, ys[hi] - ys[lo]);
      return ls[lo] + (ls[hi] - ls[lo]) * k;
    }

    function update() {
      raf = 0;
      if (!total || !pBody || !plug || !root) return;
      const sy = window.scrollY;
      const vh = window.innerHeight;
      const tipY = sy + vh * (MOB.matches ? 0.72 : 0.64) - mainTop;
      const midY = sy + vh * 0.5 - mainTop;
      const L = reduced() ? total : Math.max(lenAtY(tipY), stubLen * introL);
      const off = String(total - L);
      for (const p of drawn) {
        p.style.strokeDasharray = `${total} ${total}`;
        p.style.strokeDashoffset = off;
      }
      const pt = pBody.getPointAtLength(clamp(L, 0, total));
      plug.setAttribute("transform", `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
      pawnGeom.current.x = mainLeft + pt.x;
      placePawnRef.current();
      plug.style.opacity =
        reduced() || sy + vh * 0.3 < mainTop + (nodeYs[0] || 0) - vh * 0.6 || L >= total - 4 ? "0" : "1";
      // which gates has the tip passed
      let changed = false;
      nodeYs.forEach((y, i) => {
        const r = reduced() || tipY >= y - 4;
        if (r !== reachedRef.current[i] && !signedRef.current[i]) {
          reachedRef.current[i] = r;
          changed = true;
        }
      });
      if (changed) setReached([...reachedRef.current]);
      // where the reader is
      const first = nodeYs[0];
      const secH = nodeYs[1] - nodeYs[0];
      let c: number;
      if (midY < first - secH * 0.55) c = -1;
      else if (midY > nodeYs[N - 1] + secH * 0.55) c = N;
      else {
        c = 0;
        let bd = 1e9;
        nodeYs.forEach((y, i) => {
          const dd = Math.abs(y - midY);
          if (dd < bd) {
            bd = dd;
            c = i;
          }
        });
      }
      if (c !== curRef.current) {
        curRef.current = c;
        setCur(c);
        const inStep = c >= 0 && c < N;
        const paint = inStep ? STEP_PAINT[STEP_KEYS[c]] : c === N ? STEP_PAINT[STEP_KEYS[N - 1]] : OVERVIEW_PAINT;
        root.style.setProperty("--sc", paint.color);
        root.style.setProperty("--sc-hi", paint.hi);
      }
    }

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const relayout = () => {
      layout();
      update();
    };

    const setReducedClass = () => root.classList.toggle("reduced", reduced());
    setReducedClass();
    const onRM = () => {
      setReducedClass();
      relayout();
    };
    RM.addEventListener("change", onRM);

    window.addEventListener("scroll", schedule, { passive: true });
    let rz = 0;
    const onResize = () => {
      window.clearTimeout(rz);
      rz = window.setTimeout(relayout, 120);
    };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(() => {
      window.clearTimeout(rz);
      rz = window.setTimeout(relayout, 60);
    });
    ro.observe(main);
    relayout();
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) relayout();
    });

    // a shared /about#step-05 lands on its step, centred (the prototype did this on window load)
    const hashFrame = requestAnimationFrame(() => {
      if (/^#step-0[1-8]$/.test(location.hash)) {
        const target = root.querySelector<HTMLElement>(location.hash);
        if (target) target.scrollIntoView({ block: "center" });
      }
    });

    // scenes power on when they arrive; the art plays on DIO_ENTER; leaving re-arms it
    const ioNear = new IntersectionObserver(
      (es) => es.forEach((e) => e.target.classList.toggle("is-near", e.isIntersecting)),
      { threshold: 0.12 }
    );
    const ioIn = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          const dio = diosRef.current[sections.indexOf(e.target as HTMLElement)];
          if (!dio) return;
          if (e.intersectionRatio >= 0.3 && !dio.classList.contains("is-in")) {
            dio.classList.add("is-in");
            dio.dispatchEvent(new CustomEvent(DIO_ENTER, { bubbles: true }));
          } else if (e.intersectionRatio === 0) dio.classList.remove("is-in");
        }),
      { threshold: [0, 0.3] }
    );
    sections.forEach((s) => {
      ioNear.observe(s);
      ioIn.observe(s);
    });
    const end = root.querySelector("#end");
    if (end) ioNear.observe(end);

    // intro: short, skippable, hands control back at once
    const endIntro = () => root.classList.remove("is-intro");
    const introT = window.setTimeout(endIntro, 1800);
    const skipEvents = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    const skip = () => {
      window.clearTimeout(introT);
      endIntro();
      skipEvents.forEach((ev) => window.removeEventListener(ev, skip));
    };
    skipEvents.forEach((ev) => window.addEventListener(ev, skip, { passive: true }));
    let arriveT = 0;
    if (/[?&]in=console/.test(location.search)) {
      root.classList.add("is-arriving");
      arriveT = window.setTimeout(() => root.classList.remove("is-arriving"), 1300);
    }

    // the plug draws its first stub out of the jack
    let introRaf = 0;
    if (reduced()) introL = 1;
    else {
      const t0 = performance.now() + 500;
      const f = (now: number) => {
        const k = clamp((now - t0) / 1100, 0, 1);
        introL = 1 - Math.pow(1 - k, 3);
        update();
        if (k < 1) introRaf = requestAnimationFrame(f);
      };
      introRaf = requestAnimationFrame(f);
    }

    return () => {
      alive = false;
      RM.removeEventListener("change", onRM);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", onResize);
      window.clearTimeout(rz);
      ro.disconnect();
      ioNear.disconnect();
      ioIn.disconnect();
      cancelAnimationFrame(raf);
      cancelAnimationFrame(introRaf);
      cancelAnimationFrame(hashFrame);
      window.clearTimeout(introT);
      window.clearTimeout(arriveT);
      skipEvents.forEach((ev) => window.removeEventListener(ev, skip));
    };
  }, []);

  useEffect(() => () => window.clearTimeout(announceTimer.current), []);

  /* the pawn's label always faces the side the step's drawing is on, so it never covers the copy */
  const pawnText = cur >= 0 && cur < N ? t("pawn", { person: SAMPLE.person, n: pad2(cur + 1), name: names[cur] }) : "";
  useLayoutEffect(() => {
    const lab = pawnLabRef.current;
    const bg = pawnBgRef.current;
    const tx = pawnTxRef.current;
    if (!lab || !bg || !tx) return;
    if (!pawnText) {
      lab.style.display = "none";
      return;
    }
    lab.style.display = "";
    const w = Math.ceil(tx.getComputedTextLength() + 26);
    bg.setAttribute("width", String(w));
    bg.setAttribute("y", "-14");
    tx.setAttribute("y", "5");
    const g = pawnGeom.current;
    g.w = w;
    g.preferLeft = sectionsRef.current[cur]?.dataset.side === "l";
    g.bx = Number.NaN;
    if (g.x < 0) {
      // before the scroll loop has placed the plug: the preferred side, as the prototype drew it
      bg.setAttribute("x", String(g.preferLeft ? -(27 + w) : 27));
      tx.setAttribute("x", String(g.preferLeft ? -(27 + w) + 13 : 40));
    } else placePawnLabel();
  }, [cur, pawnText, placePawnLabel]);

  const value = useMemo<LineState>(
    () => ({ names, signed, reached, just, cur, sign, goTo, replay }),
    [names, signed, reached, just, cur, sign, goTo, replay]
  );

  const steps = names.map((name, i) => ({ label: t("stepper.dot", { n: i + 1, name }), signed: signed[i] }));
  const prevName = cur <= 0 ? t("stepper.overview") : names[cur - 1];
  const nextName = cur >= N - 1 ? t("stepper.finale") : names[cur + 1];
  const count =
    cur >= 0 && cur < N
      ? t("stepper.count", { n: pad2(cur + 1), total: pad2(N), name: names[cur] })
      : cur === N
        ? t("stepper.whole")
        : t("stepper.overview");

  return (
    <LineContext.Provider value={value}>
      <Stepper
        id="deck"
        ariaLabel={t("stepper.label")}
        dotsLabel={t("stepper.dots")}
        steps={steps}
        active={cur}
        onSelect={(i) => goTo(i)}
        onPrev={() => goTo(cur <= 0 ? "map" : cur - 1)}
        onNext={() => goTo(cur >= N - 1 ? "end" : cur + 1)}
        prevLabel={prevName}
        nextLabel={nextName}
        prevDisabled={cur <= -1}
        nextDisabled={cur >= N}
        count={count}
      />
      {lead}
      <main id="main" ref={mainRef}>
        {/* THE CABLE: one line for the whole page, drawn from the real positions of the gates */}
        <svg className="cable" id="cable" ref={cableRef} aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id="cableGrad" ref={gradRef} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="1" />
          </defs>
          <path className="sp-track" id="cDash" ref={trackRef} fill="none" />
          <path className="sp-rim" id="cGroove" ref={rimRef} fill="none" />
          <path className="sp-ink" id="cShadow" ref={inkRef} fill="none" />
          <path className="sp-col" id="cBody" ref={bodyRef} fill="none" stroke="url(#cableGrad)" />
        </svg>
        <svg className="cable cable-top" id="cableTop" ref={cableTopRef} aria-hidden="true" focusable="false">
          {/* hidden until the first layout places it at the tip (the prototype's script ran before first paint) */}
          <g id="plug" className="pawn" ref={plugRef} style={{ opacity: 0 }}>
            <g className="pawn-lab" id="pawnLab" ref={pawnLabRef} style={{ display: "none" }}>
              <rect className="pl-bg" id="pawnBg" ref={pawnBgRef} rx="14" ry="14" height="28" />
              <text className="pl-tx" id="pawnTx" ref={pawnTxRef} y="19">
                {pawnText}
              </text>
            </g>
            <circle className="pawn-j" r="19" />
            <text className="pawn-t" y="7" textAnchor="middle">
              {SAMPLE.pawn}
            </text>
          </g>
        </svg>
        {children}
      </main>
      <div className="sr" id="live" ref={liveRef} aria-live="polite" aria-atomic="true" />
    </LineContext.Provider>
  );
}
