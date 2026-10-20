"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useLine } from "./AboutLine";
import { CheckIcon, PenIcon, ReplayIcon } from "./icons";
import { REDUCED_QUERY, SAMPLE, STEP_COUNT as N, STEP_KEYS, STEP_PAINT, pad2 } from "./steps";

/* The interactive pieces the server-rendered page places, all reading THE LINE's state (./AboutLine.tsx). */

type GateState = "idle" | "wait" | "ok";

function useGateState(i: number): GateState {
  const { signed, reached } = useLine();
  return signed[i] ? "ok" : reached[i] ? "wait" : "idle";
}

/** The human gate under a step's copy: idle, then waiting (amber) once the line reaches it, signed (lime) on press. */
export function GateButton({ i }: { i: number }) {
  const t = useTranslations("siteAbout");
  const { names, sign } = useLine();
  const state = useGateState(i);
  const vars = { n: pad2(i + 1), name: names[i], signer: SAMPLE.signer };
  const text = state === "ok" ? t("gate.signed", vars) : state === "wait" ? t("gate.wait") : t("gate.idle");
  const key = state === "wait" ? t("gate.sign") : "";
  const aria = state === "ok" ? t("gate.ariaSigned", vars) : state === "wait" ? t("gate.ariaWait", vars) : t("gate.ariaIdle", vars);
  return (
    <button
      type="button"
      className="btn btn-sm gate"
      data-gate={i}
      data-state={state}
      style={{ "--i": 3 } as CSSProperties}
      aria-label={aria}
      onClick={() => sign(i)}
    >
      <i className="lamp" aria-hidden="true" />
      <span className="gt">{text}</span>
      <span className="gk" hidden={!key}>
        {key}
      </span>
    </button>
  );
}

/** The step's node on the ribbon: a numbered disc that takes the step's colour, and a pen badge (a check once signed). */
export function StepNode({ i }: { i: number }) {
  const state = useGateState(i);
  return (
    <div className="node" data-state={state}>
      <span className="nd-disc">{pad2(i + 1)}</span>
      <span className="nd-pen" aria-hidden="true">
        {state === "ok" ? <CheckIcon /> : <PenIcon />}
      </span>
    </div>
  );
}

export function ReplayButton({ i }: { i: number }) {
  const t = useTranslations("siteAbout");
  const { names, replay } = useLine();
  return (
    <button
      type="button"
      className="btn btn-sm replay"
      data-replay={i}
      aria-label={t("replay.aria", { name: names[i] })}
      onClick={() => replay(i)}
    >
      <ReplayIcon />
      <span>{t("replay.label")}</span>
    </button>
  );
}

/** "Scroll to draw the line": a link to step 01 that scrolls there the page's way. */
export function CueLink({ href, children }: { href: string; children: ReactNode }) {
  const { goTo } = useLine();
  return (
    <a
      className="cue-a"
      href={href}
      data-go="0"
      onClick={(e) => {
        e.preventDefault();
        goTo(0);
      }}
    >
      {children}
    </a>
  );
}

/** The receipts tape in the finale: one line per gate, fed as the reader signs. */
export function TapeUnit() {
  const t = useTranslations("siteAbout");
  const { names, signed, just } = useLine();
  const done = signed.filter(Boolean).length;
  return (
    <div className={done === N ? "tape-unit is-complete" : "tape-unit"}>
      <div className="tape-head">
        <span className="sil">{t("tape.title")}</span>
        <i className="tape-slot" aria-hidden="true" />
        <span className="tape-count sil" id="tapeCount">
          {t("tape.count", { done, total: N })}
        </span>
      </div>
      <div className="tape-paper">
        <ol className="tape" id="tape">
          {STEP_KEYS.map((key, i) => (
            <li key={key} className={(signed[i] ? "is-ok" : "is-wait") + (i === just ? " just" : "")}>
              <b>{`${pad2(i + 1)} ${names[i]}`}</b>
              <span>{signed[i] ? t("gate.signed", { signer: SAMPLE.signer }) : t("tape.waiting")}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/* ---------- the hero: the whole route as one LCD, and a sample token that plays the eight steps ---------- */
const ST_XY: readonly (readonly [number, number])[] = [
  [12, 22],
  [37, 22],
  [63, 22],
  [88, 22],
  [88, 78],
  [63, 78],
  [37, 78],
  [12, 78]
];
const ROUTE = "M12 22L88 22C99 22 99 78 88 78L12 78";
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function HeroMap() {
  const t = useTranslations("siteAbout");
  const { names, signed, goTo } = useLine();
  const [mapCur, setMapCur] = useState(0);
  const [mapSigned, setMapSigned] = useState(false);
  const lcdRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<SVGPathElement>(null);
  const tokRef = useRef<HTMLSpanElement>(null);
  const paused = useRef(false);

  useEffect(() => {
    const lcd = lcdRef.current;
    const fill = fillRef.current;
    const tok = tokRef.current;
    if (!lcd || !fill || !tok) return;
    const reduced = () => window.matchMedia(REDUCED_QUERY).matches;
    const probe = document.createElementNS("http://www.w3.org/2000/svg", "path");
    probe.setAttribute("d", ROUTE);
    const routeLen = probe.getTotalLength();
    const stLen = ST_XY.map(([x, y]) => {
      let best = 0;
      let bd = 1e9;
      for (let L = 0; L <= routeLen; L += 0.5) {
        const q = probe.getPointAtLength(L);
        const d = Math.hypot(q.x - x, q.y - y);
        if (d < bd) {
          bd = d;
          best = L;
        }
      }
      return best;
    });
    let cur = -1;
    let mapL = 0;
    let tween = 0;
    let signT = 0;
    let visible = true;
    const tokAt = (L: number) => {
      const q = probe.getPointAtLength(clamp(L, 0, routeLen));
      tok.style.left = `${q.x}%`;
      tok.style.top = `${q.y}%`;
      tok.classList.toggle("below", q.y > 50);
      fill.style.strokeDashoffset = String(100 - (100 * clamp(L, 0, routeLen)) / routeLen);
    };
    const mapTo = (i: number, instant = false) => {
      cur = i;
      const target = stLen[i];
      const from = mapL;
      const t0 = performance.now();
      const dur = instant || reduced() ? 0 : 850;
      cancelAnimationFrame(tween);
      const step = (now: number) => {
        const k = dur ? clamp((now - t0) / dur, 0, 1) : 1;
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        mapL = from + (target - from) * e;
        tokAt(mapL);
        if (k < 1) tween = requestAnimationFrame(step);
      };
      step(t0);
      setMapCur(i);
      setMapSigned(false);
      window.clearTimeout(signT);
      signT = window.setTimeout(
        () => {
          if (cur === i) setMapSigned(true);
        },
        reduced() ? 0 : 900
      );
    };
    mapTo(0, true);
    tokAt(stLen[0]);
    const io = new IntersectionObserver((es) => {
      visible = es[0].isIntersecting;
    }, { threshold: 0.1 });
    io.observe(lcd);
    const timer = reduced()
      ? 0
      : window.setInterval(() => {
          if (paused.current || !visible || document.hidden) return;
          mapTo((cur + 1) % N);
        }, 1700);
    return () => {
      io.disconnect();
      window.clearInterval(timer);
      window.clearTimeout(signT);
      cancelAnimationFrame(tween);
    };
  }, []);

  const name = names[mapCur];
  return (
    <div
      className="hero-lcd"
      id="heroLcd"
      ref={lcdRef}
      onPointerEnter={() => {
        paused.current = true;
      }}
      onPointerLeave={() => {
        paused.current = false;
      }}
      onFocus={() => {
        paused.current = true;
      }}
      onBlur={() => {
        paused.current = false;
      }}
    >
      <div className="bz">
        <div className="gl" id="mapGlass">
          <div className="map">
            <div className="map-top sil">
              <span className="map-live">
                <i className={mapSigned ? "led on-ok" : "led on-wait"} id="mapLed" />
                {t("map.live")}
              </span>
              <span className="tag">{t("map.tag")}</span>
            </div>
            <div className="map-field" id="mapField">
              <svg className="route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                <path className="r-groove" d={ROUTE} />
                <path
                  className="r-fill"
                  id="rFill"
                  ref={fillRef}
                  d={ROUTE}
                  pathLength={100}
                  strokeDasharray="100"
                  strokeDashoffset="100"
                />
              </svg>
              {STEP_KEYS.map((key, i) => {
                const cls = ["st", i > 3 ? "up" : "", i === mapCur ? "is-cur" : "", i < mapCur ? "is-done" : "", signed[i] ? "is-signed" : ""]
                  .filter(Boolean)
                  .join(" ");
                const style = { left: `${ST_XY[i][0]}%`, top: `${ST_XY[i][1]}%`, "--c": STEP_PAINT[key].color } as CSSProperties;
                return (
                  <button
                    key={key}
                    type="button"
                    className={cls}
                    data-go={i}
                    style={style}
                    aria-label={t("map.go", { n: i + 1, name: names[i] })}
                    onClick={() => goTo(i)}
                  >
                    <span className="st-disc">{pad2(i + 1)}</span>
                    <span className="st-lbl">{names[i]}</span>
                  </button>
                );
              })}
              <span className="tok" id="tok" ref={tokRef} aria-hidden="true" style={{ left: "12%", top: "22%" }}>
                {SAMPLE.initials}
              </span>
            </div>
            <div className="map-read" aria-hidden="true">
              <span className="rd-n" id="rdN">
                {pad2(mapCur + 1)}
              </span>
              <div className="rd-t">
                <b className="rd-name" id="rdName">
                  {name}
                </b>
                <span className="rd-state" id="rdState">
                  {mapSigned ? t("gate.signed", { signer: SAMPLE.signer }) : t("gate.wait")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <span className="jack" id="jackStart" aria-hidden="true">
        <i />
      </span>
    </div>
  );
}

/* ---------- dust in the light cone ---------- */
type Mote = { x: number; y: number; r: number; vx: number; vy: number; a: number; ph: number };

export function Dust() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const NP = 34;
    let W = 0;
    let H = 0;
    let last = 0;
    let frame = 0;
    const size = () => {
      W = c.width = Math.max(320, window.innerWidth);
      H = c.height = Math.max(320, window.innerHeight);
    };
    size();
    let rt = 0;
    const onResize = () => {
      window.clearTimeout(rt);
      rt = window.setTimeout(size, 160);
    };
    window.addEventListener("resize", onResize);
    const P: Mote[] = Array.from({ length: NP }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.6 + Math.random() * 1.9,
      vx: 0.00004 + Math.random() * 0.00012,
      vy: -0.00003 - Math.random() * 0.0001,
      a: 0.1 + Math.random() * 0.3,
      ph: Math.random() * 6.28
    }));
    const draw = (time: number) => {
      g.clearRect(0, 0, W, H);
      for (const p of P) {
        p.x += p.vx * 16;
        p.y += p.vy * 16;
        if (p.x > 1.02) p.x = -0.02;
        if (p.y < -0.02) p.y = 1.02;
        const cone = Math.max(0, 1 - Math.hypot(p.x - 0.16, p.y + 0.05) / 0.95);
        const tw = 0.6 + 0.4 * Math.sin(time / 1400 + p.ph);
        g.fillStyle = `rgba(255,226,176,${(p.a * (0.25 + cone) * tw).toFixed(3)})`;
        g.beginPath();
        g.arc(p.x * W, p.y * H, p.r, 0, 6.283);
        g.fill();
      }
    };
    const loop = (time: number) => {
      frame = requestAnimationFrame(loop);
      if (document.hidden || time - last < 33) return;
      last = time;
      draw(time);
    };
    if (window.matchMedia(REDUCED_QUERY).matches) draw(0);
    else frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(rt);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return <canvas id="dust" ref={ref} />;
}
