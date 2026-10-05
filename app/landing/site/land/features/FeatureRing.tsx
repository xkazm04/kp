"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  arrowStep,
  hashAfterClose,
  parseSpotlightHash,
  spotlightHash,
  urlWithHash
} from "@/app/landing/spark/previews/order";
import { GLYPH } from "../../chrome/glyphs";
import { headlineFit } from "../headlineFit";
import { MK_ROOT_SELECTOR } from "../../chrome/rootState";
import { FeatureArt } from "./art";
import { FEATURE_COUNT, FEATURES } from "./featureData";
import { MQ_MOBILE, MQ_REDUCED, useMedia, vars } from "./panels/kit";
import { RING_BOX, RING_LENGTH, medalPosition, ringPoint } from "./ring";
import { SAMPLE } from "./sample";
import Scene from "./Scene";

/*
 * The features band's interactive half (prototype land/app.js "features" +
 * "scene"): nine medallions on one ring in funnel order, the stage in the middle
 * that names the one under the pointer or focus, the "JN" card that travels the
 * ring while nothing is attended, and the scene each medallion opens.
 *
 * The scene is a modal dialog: it opens with a circle wipe from its opener,
 * focus moves to its title, the page behind goes inert and stops scrolling, Tab
 * cycles inside it (plus the phone CTA dock, as in the prototype), Escape goes
 * one level up (Look closer -> scene -> closed) and closing returns focus to the
 * opener. ArrowLeft / ArrowRight and the Stepper walk the nine.
 *
 * It is an ADDRESS too, with app/landing/spark/previews/order.ts semantics: an
 * open scene is `/#spotlight-<key>` (replaceState, so the walk is a scrubber and
 * not nine Back steps), arriving at or navigating to that hash opens it, and
 * closing puts back whatever hash was there before. Any in-page link to
 * `#spotlight-<key>` (the hero's "How Jana got 87") opens a scene with no code of
 * its own.
 */
const noop = () => () => {};
const findRoot = () => document.querySelector<HTMLElement>(`${MK_ROOT_SELECTOR}[data-page="land"]`);
const noRoot = () => null;

/** Elements the prototype made inert behind an open scene. */
const BEHIND = ["#main", "#bar", ".foot", "#spine", ".menu"];

const MEDALS = FEATURES.map((f, i) => ({ ...f, pos: medalPosition(i, FEATURE_COUNT) }));

/**
 * Where the circle wipe opens from / closes to: the centre of the element that
 * opened the scene, or the viewport's centre when that element is off screen (a
 * `/#spotlight-<key>` arrival opens from a medallion far below the fold, and a
 * 150vmax circle centred there would not cover the viewport).
 */
function wipeCentre(el: HTMLElement | null): { cx: string; cy: string } {
  const r = el && el.isConnected ? el.getBoundingClientRect() : null;
  const x = r ? r.left + r.width / 2 : -1;
  const y = r ? r.top + r.height / 2 : -1;
  if (!r || x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
    return { cx: `${window.innerWidth / 2}px`, cy: `${window.innerHeight / 2}px` };
  }
  return { cx: `${x}px`, cy: `${y}px` };
}

export default function FeatureRing({ signupOpen }: { signupOpen: boolean }) {
  const t = useTranslations("siteFeatures");
  const tl = useTranslations("landing");
  const reduced = useMedia(MQ_REDUCED);
  const mobile = useMedia(MQ_MOBILE);
  // The site root to portal the scene into; null on the server and while hydrating.
  const portalRoot = useSyncExternalStore(noop, findRoot, noRoot);

  /* ---------- the ring ---------- */
  const ringRef = useRef<HTMLDivElement | null>(null);
  const markRef = useRef<HTMLDivElement | null>(null);
  const medalRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [current, setCurrent] = useState(-1);
  const [staged, setStaged] = useState(-1);
  const [pass, setPass] = useState(-1);
  const currentRef = useRef(-1);
  const passRef = useRef(-1);
  const leaveTimer = useRef(0);

  const attend = (i: number) => {
    window.clearTimeout(leaveTimer.current);
    currentRef.current = i;
    passRef.current = -1;
    setCurrent(i);
    setStaged(i);
    setPass(-1);
  };
  const unattend = () => {
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => {
      currentRef.current = -1;
      setCurrent(-1);
    }, 90);
  };
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  // The travelling card: a rAF loop while the ring is on screen, never under
  // reduced motion or on the phone layout (where CSS hides it anyway).
  useEffect(() => {
    const ring = ringRef.current;
    const mark = markRef.current;
    if (!ring || !mark || reduced || mobile || !("IntersectionObserver" in window)) return;
    let raf = 0;
    let last = 0;
    let travel = 0;
    const step = RING_LENGTH / FEATURE_COUNT;
    const frame = (ts: number) => {
      const dt = last ? Math.min(60, ts - last) : 16;
      last = ts;
      if (currentRef.current < 0) travel = (travel + ((dt / 1000) * RING_LENGTH) / 26) % RING_LENGTH;
      const p = ringPoint(travel);
      const w = ring.clientWidth;
      const h = ring.clientHeight;
      mark.style.transform = `translate(${((p.x / RING_BOX.w) * w - mark.offsetWidth / 2).toFixed(1)}px,${((p.y / RING_BOX.h) * h - mark.offsetHeight / 2).toFixed(1)}px) rotate(${(Math.sin(travel / 70) * 9).toFixed(1)}deg)`;
      if (currentRef.current < 0) {
        const near = Math.round(travel / step) % FEATURE_COUNT;
        const d = Math.abs(travel - Math.round(travel / step) * step);
        const next = d < step * 0.13 ? near : -1;
        if (next !== passRef.current) {
          passRef.current = next;
          setPass(next);
        }
      }
      raf = window.requestAnimationFrame(frame);
    };
    const io = new IntersectionObserver(
      (entries) => {
        const inView = entries[0]?.isIntersecting ?? false;
        window.cancelAnimationFrame(raf);
        last = 0;
        if (inView) raf = window.requestAnimationFrame(frame);
      },
      { threshold: 0.15 }
    );
    io.observe(ring);
    return () => {
      io.disconnect();
      window.cancelAnimationFrame(raf);
    };
  }, [reduced, mobile]);

  /* ---------- the scene ---------- */
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const [active, setActive] = useState(false);
  const [shown, setShown] = useState(false);
  const [grown, setGrown] = useState(false);
  const [idx, setIdx] = useState(0);
  const [detail, setDetailState] = useState(false);
  const [swap, setSwap] = useState<{ on: boolean; dir: 1 | -1 }>({ on: false, dir: 1 });
  const [center, setCenter] = useState({ cx: "50%", cy: "50%" });
  const [clip, setClip] = useState<string | undefined>(undefined);
  const activeRef = useRef(false);
  const idxRef = useRef(0);
  const detailRef = useRef(false);
  const originRef = useRef<HTMLElement | null>(null);
  const priorHash = useRef<string | null | undefined>(undefined);
  /** Undoes the open scene's inert + scroll lock; closeScene runs it before
   *  handing focus back (an inert opener cannot take focus). */
  const releaseRef = useRef<(() => void) | null>(null);
  const timers = useRef<{ swap: number; hide: number; focus: number; raf: number }>({ swap: 0, hide: 0, focus: 0, raf: 0 });

  useEffect(() => {
    const tm = timers.current;
    return () => {
      window.clearTimeout(tm.swap);
      window.clearTimeout(tm.hide);
      window.clearTimeout(tm.focus);
      window.cancelAnimationFrame(tm.raf);
    };
  }, []);

  const writeHash = useCallback((hash: string) => {
    const { pathname, search } = window.location;
    try {
      history.replaceState(history.state, "", urlWithHash(pathname, search, hash));
    } catch {
      /* best-effort: the address is a convenience, the scene works without it */
    }
  }, []);

  const setDetail = useCallback((on: boolean) => {
    detailRef.current = on;
    setDetailState(on);
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, []);

  const openScene = useCallback(
    (i: number, origin: HTMLElement | null) => {
      const tm = timers.current;
      window.clearTimeout(tm.hide);
      window.clearTimeout(tm.swap);
      window.cancelAnimationFrame(tm.raf);
      originRef.current = origin ?? medalRefs.current[i] ?? null;
      const { cx, cy } = wipeCentre(originRef.current);
      activeRef.current = true;
      idxRef.current = i;
      detailRef.current = false;
      setActive(true);
      setIdx(i);
      setDetailState(false);
      setSwap({ on: false, dir: 1 });
      setCenter({ cx, cy });
      setClip(`circle(0px at ${cx} ${cy})`);
      setGrown(false);
      setShown(true);
      // Two frames: the first paints the closed circle at the opener, the second
      // grows it, so the clip-path transition has a start to run from.
      tm.raf = window.requestAnimationFrame(() => {
        tm.raf = window.requestAnimationFrame(() => {
          setClip(undefined);
          setGrown(true);
        });
      });
      if (priorHash.current === undefined) {
        const now = window.location.hash;
        priorHash.current = parseSpotlightHash(now) ? null : now || null;
      }
      writeHash(spotlightHash(FEATURES[i].key));
      window.clearTimeout(tm.focus);
      tm.focus = window.setTimeout(() => titleRef.current?.focus({ preventScroll: true }), 140);
    },
    [writeHash]
  );

  const closeScene = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    const tm = timers.current;
    window.cancelAnimationFrame(tm.raf);
    window.clearTimeout(tm.swap);
    window.clearTimeout(tm.focus);
    const o = originRef.current;
    const { cx, cy } = wipeCentre(o);
    setActive(false);
    setCenter({ cx, cy });
    setGrown(false);
    setClip(`circle(0px at ${cx} ${cy})`);
    setSwap((s) => ({ ...s, on: false }));
    const reduce = window.matchMedia(MQ_REDUCED).matches;
    window.clearTimeout(tm.hide);
    tm.hide = window.setTimeout(() => {
      if (activeRef.current) return;
      setShown(false);
      setClip(undefined);
    }, reduce ? 240 : 900);
    if (priorHash.current !== undefined) {
      writeHash(hashAfterClose(priorHash.current));
      priorHash.current = undefined;
    }
    releaseRef.current?.();
    if (o && o.isConnected) o.focus({ preventScroll: true });
  }, [writeHash]);

  const gotoScene = useCallback(
    (target: number, dir?: 1 | -1) => {
      const i = ((target % FEATURE_COUNT) + FEATURE_COUNT) % FEATURE_COUNT;
      if (i === idxRef.current) return;
      const d: 1 | -1 = dir ?? (i > idxRef.current ? 1 : -1);
      const tm = timers.current;
      setSwap({ on: true, dir: d });
      window.clearTimeout(tm.swap);
      tm.swap = window.setTimeout(
        () => {
          if (!activeRef.current) return;
          originRef.current = medalRefs.current[i] ?? originRef.current;
          idxRef.current = i;
          setIdx(i);
          setDetail(false);
          setSwap({ on: false, dir: d });
          writeHash(spotlightHash(FEATURES[i].key));
        },
        window.matchMedia(MQ_REDUCED).matches ? 0 : 230
      );
    },
    [setDetail, writeHash]
  );

  // While a scene is open: the page behind is inert and does not scroll, and
  // the keyboard belongs to the scene.
  useEffect(() => {
    if (!active) return;
    const root = sceneRef.current?.closest<HTMLElement>(MK_ROOT_SELECTOR);
    const behind = BEHIND.flatMap((sel) => Array.from(root?.querySelectorAll<HTMLElement>(sel) ?? []));
    behind.forEach((el) => {
      el.inert = true;
    });
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = "hidden";
    let held = true;
    const release = () => {
      if (!held) return;
      held = false;
      behind.forEach((el) => {
        el.inert = false;
      });
      html.style.overflow = prevOverflow;
    };
    releaseRef.current = release;

    const onKey = (e: KeyboardEvent) => {
      const scene = sceneRef.current;
      if (!scene) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (detailRef.current) setDetail(false);
        else closeScene();
        return;
      }
      const dir = arrowStep(e, e.target instanceof HTMLElement ? e.target : null);
      if (dir !== null) {
        e.preventDefault();
        gotoScene(idxRef.current + dir, dir);
        return;
      }
      if (e.key !== "Tab") return;
      const visible = (el: HTMLElement) => el.getClientRects().length > 0 && !el.hidden;
      let els = Array.from(scene.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(visible);
      const at = document.activeElement;
      if (window.matchMedia(MQ_MOBILE).matches && root) {
        // On phones the CTA dock stays usable over the scene and joins the cycle
        // after it (prototype order). The dock sits BEFORE the portalled scene in
        // the DOM, so the browser's own Tab order cannot be trusted here: walk
        // the combined list by hand.
        els = els.concat(Array.from(root.querySelectorAll<HTMLElement>("#dock a, #dock button")).filter(visible));
        const k = at instanceof HTMLElement ? els.indexOf(at) : -1;
        // From the title (focusable only by script) the browser's next stop is
        // already inside the scene.
        if (!els.length || (k < 0 && scene.contains(at))) return;
        e.preventDefault();
        const n = els.length;
        const to = k < 0 ? (e.shiftKey ? n - 1 : 0) : (k + (e.shiftKey ? -1 : 1) + n) % n;
        els[to].focus();
        return;
      }
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && (at === first || at === scene)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      release();
      if (releaseRef.current === release) releaseRef.current = null;
    };
  }, [active, closeScene, gotoScene, setDetail]);

  // `/#spotlight-<key>`: on arrival, and on any in-page navigation to one.
  useEffect(() => {
    const fromHash = () => {
      const key = parseSpotlightHash(window.location.hash);
      if (!key) return;
      const i = FEATURES.findIndex((f) => f.key === key);
      if (i < 0) return;
      if (activeRef.current) {
        gotoScene(i);
        return;
      }
      const at = document.activeElement;
      openScene(i, at instanceof HTMLElement && at !== document.body ? at : null);
    };
    const raf = window.requestAnimationFrame(fromHash);
    window.addEventListener("hashchange", fromHash);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("hashchange", fromHash);
    };
  }, [openScene, gotoScene]);

  const stage = staged >= 0 ? FEATURES[staged] : null;
  // The centre heading's widest line in em: a locale whose line would not fit the stage is set smaller (the CSS keeps
  // it to the two lines the ring leaves room for; a third ran into the medallion labels).
  const headingRaw: unknown = tl.raw("features.heading");
  const headingFit = { "--fh-em": typeof headingRaw === "string" ? headlineFit(headingRaw).line : 0.01 } as CSSProperties;
  const ringClass = current >= 0 ? "ring has-focus" : "ring";

  return (
    <div className={ringClass} id="ring" ref={ringRef}>
      <svg className="ring-line" viewBox="0 0 1240 720" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <ellipse cx="620" cy="356" rx="498" ry="262" fill="none" stroke="#526b4f" strokeOpacity=".55" strokeWidth="3" strokeDasharray="2 12" strokeLinecap="round" />
      </svg>
      <div className="ring-stage" style={stage ? vars({ "--c": stage.deep }) : undefined}>
        <div className="rs-idle">
          <h2 id="featH" style={headingFit}>{tl.rich("features.heading", { br: () => <br /> })}</h2>
          <p className="hand">{t("band.hint")}</p>
          <button className="btn btn-sm primary rs-cta" type="button" onClick={(e) => openScene(0, e.currentTarget)}>
            {t("band.cta")} <span aria-hidden="true">{GLYPH.next}</span>
          </button>
        </div>
        <div className="rs-on" aria-hidden="true">
          <p className="rs-n">{stage ? t("band.stage", { n: stage.n, total: FEATURE_COUNT }) : null}</p>
          <p className="rs-name" style={stage ? ({ "--rn-em": headlineFit(tl(`features.${stage.key}.title`)).line } as CSSProperties) : undefined}>
            {stage ? tl(`features.${stage.key}.title`) : null}
          </p>
          <p className="rs-line">{stage ? t(`items.${stage.key}.line`) : null}</p>
          <p className="rs-open">
            {t("band.open")} {GLYPH.next}
          </p>
        </div>
      </div>
      <div className="ring-mark" ref={markRef} aria-hidden="true" style={reduced ? { display: "none" } : undefined}>
        <span>{SAMPLE.ringMark}</span>
      </div>
      {MEDALS.map((m, i) => {
        const cls = ["medal", i === current ? "is-on" : null, current < 0 && i === pass ? "is-pass" : null].filter(Boolean).join(" ");
        return (
          <button
            key={m.key}
            ref={(el) => {
              medalRefs.current[i] = el;
            }}
            type="button"
            className={cls}
            style={vars({ "--x": m.pos.x, "--y": m.pos.y })}
            aria-label={t("band.medal", { name: tl(`features.${m.key}.title`), n: m.n, total: FEATURE_COUNT })}
            onPointerEnter={() => attend(i)}
            onFocus={() => attend(i)}
            onPointerLeave={unattend}
            onBlur={unattend}
            onClick={(e) => openScene(i, e.currentTarget)}
          >
            <FeatureArt feature={m.key} />
            <span className="num" aria-hidden="true">
              {m.n}
            </span>
            <span className="lbl" aria-hidden="true">
              {tl(`features.${m.key}.title`)}
            </span>
          </button>
        );
      })}
      {portalRoot
        ? createPortal(
            <Scene
              signupOpen={signupOpen}
              idx={idx}
              shown={shown}
              grown={grown}
              detail={detail}
              swapping={swap.on}
              dir={swap.dir}
              center={center}
              clip={clip}
              mobile={mobile}
              sceneRef={sceneRef}
              mainRef={mainRef}
              titleRef={titleRef}
              onBack={() => (detailRef.current ? setDetail(false) : closeScene())}
              onLook={() => setDetail(!detailRef.current)}
              onGoto={gotoScene}
            />,
            portalRoot
          )
        : null}
    </div>
  );
}
