"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useScroll, useSpring, useTransform } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Wordmark from "./Wordmark";
import { LandingLangSwitch } from "./LandingLangSwitch";
import { ABOUT_STEP_KEYS, StepArt, type AboutStepKey } from "./about-art";
import { ART_TYPE_SCALE } from "./tokens";
import { useStillMotion } from "./useStillMotion";
import { useTranslations } from "next-intl";
import { enterWorkspace } from "@/app/_lib/auth/session-nav";

/*
 * /about — the public concept introduction as a scroll-drawn curved timeline of
 * the pipeline phases the app actually walks (ABOUT_STEP_KEYS, in about-art/shared.ts).
 * Same Spark art direction as the home landing (literal hexes — the docs/design/README.md
 * exemption); all copy resolves through the `aboutPage` i18n namespace. The spine draws
 * with scroll and each step grows to full size at centre, then shrinks as it passes.
 */
const DISPLAY = "font-[family-name:var(--font-spark-display)]";
const HAND = "font-[family-name:var(--font-spark-hand)]";

// Structural only — eyebrow/title/body come from aboutPage.steps.<key>, and the
// ORDER comes from ABOUT_STEP_KEYS. A `Record` rather than a parallel list, so a
// phase added to the vocabulary is a type error here until it is given a colour
// instead of silently drawing in whatever the array's shorter half held.
const STEP_COLOR: Record<AboutStepKey, string> = {
  design: "#42606f",
  source: "#caa54c",
  intake: "#d65a4a",
  screen: "#526b4f",
  assignment: "#42606f",
  interview: "#d65a4a",
  offer: "#caa54c",
  hired: "#526b4f"
};
const STEPS = ABOUT_STEP_KEYS.map((key) => ({ key, color: STEP_COLOR[key] }));

/*
 * The serpentine spine, DERIVED from the step list rather than hand-plotted.
 *
 * It used to be nine literal cubic segments matching seven node rows. That is
 * the kind of constant nobody re-derives: adding the assignment phase would have
 * left an eighth node row hanging off the end of a seven-row spine, and the
 * defect would have been invisible in a diff and visible only on the page.
 *
 * Each phase's node sits at the centre of its own 1/N slice of the 0–1000
 * viewBox, the curve crosses centre (x=70) there, and the control column
 * alternates 116/24 so the line weaves right, left, right. For N=7 this
 * reproduces the previous path to within a unit.
 */
const ROW_Y = ABOUT_STEP_KEYS.map((_, i) => Math.round(((i + 0.5) * 1000) / ABOUT_STEP_KEYS.length));
const SPINE = [
  "M70 0",
  ...ROW_Y.map((y, i) => {
    const from = i === 0 ? 0 : ROW_Y[i - 1];
    const third = (y - from) / 3;
    const cx = i % 2 === 0 ? 116 : 24;
    return `C ${cx} ${Math.round(from + third)}, ${cx} ${Math.round(from + 2 * third)}, 70 ${y}`;
  }),
  // The tail runs straight down from the last node to the bottom edge.
  (() => {
    const last = ROW_Y[ROW_Y.length - 1];
    const third = (1000 - last) / 3;
    return `C 70 ${Math.round(last + third)}, 70 ${Math.round(last + 2 * third)}, 70 1000`;
  })()
].join(" ");

function StepRow({ stepKey, color, n, index }: { stepKey: AboutStepKey; color: string; n: number; index: number }) {
  const t = useTranslations("aboutPage");
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const scale = useSpring(useTransform(scrollYProgress, [0, 0.5, 1], [0.74, 1, 0.82]), {
    stiffness: 110,
    damping: 26
  });
  const opacity = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0.1, 1, 1, 0.15]);
  const dot = useTransform(scrollYProgress, [0.34, 0.5], [0, 1]);
  const artLeft = index % 2 === 0;

  return (
    <div ref={ref} className="relative grid min-h-[80vh] items-center gap-6 py-10 md:grid-cols-[1fr_auto_1fr] md:gap-10">
      {/* ART_TYPE_SCALE: the step illustrations are mockups of product UI, so
          they were drawn at product text sizes and ended up a full step smaller
          than the copy beside them. One class on the art column lifts every
          size inside the card; see app/globals.css. */}
      <motion.div
        style={{ scale, opacity }}
        className={`${ART_TYPE_SCALE} flex justify-center ${artLeft ? "md:order-1" : "md:order-3"}`}
      >
        <StepArt stepKey={stepKey} color={color} />
      </motion.div>

      <div className="relative order-first hidden w-24 self-stretch md:order-2 md:block">
        <motion.span
          style={{ scale: dot, background: color }}
          className={`${DISPLAY} absolute left-1/2 top-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[3px] border-[#17202a] text-base font-extrabold text-white shadow-[3px_3px_0_#17202a]`}
        >
          {String(n).padStart(2, "0")}
        </motion.span>
      </div>

      <motion.div style={{ opacity, scale }} className={artLeft ? "md:order-3 md:text-left" : "md:order-1 md:text-right"}>
        <p className={`${HAND} text-lg`} style={{ color }}>
          {t(`steps.${stepKey}.eyebrow`)}
        </p>
        <h2 className={`${DISPLAY} mt-1 text-3xl font-extrabold sm:text-4xl`}>{t(`steps.${stepKey}.title`)}</h2>
        <p className="mt-3 text-lg leading-relaxed text-[#42606f]">{t(`steps.${stepKey}.body`)}</p>
      </motion.div>
    </div>
  );
}

export default function AboutCurve() {
  const t = useTranslations("aboutPage");
  const trackRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useStillMotion();
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ["start center", "end end"] });
  const pathLength = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });
  const onSignIn = () => void enterWorkspace();
  const coralEmph = (chunks: React.ReactNode) => <span className="text-[#d65a4a]">{chunks}</span>;

  return (
    <main className="overflow-x-clip bg-[#fdf8ee] pb-28 text-[#17202a] font-[family-name:var(--font-spark-body)]">
      {/* ── Topbar ─────────────────────────────────────────────── */}
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 pt-6">
        <Link href="/">
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-6 text-[17px] font-bold sm:flex">
          <Link href="/" className="hover:text-[#d65a4a]">
            {t("nav.home")}
          </Link>
          <button
            type="button"
            onClick={onSignIn}
            className="rounded-lg border-[3px] border-[#17202a] bg-[#caa54c] px-4 py-2 shadow-[3px_3px_0_#17202a] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_#17202a]"
          >
            {t("nav.signIn")}
          </button>
        </nav>
      </header>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-6 pb-4 pt-24 text-center">
        <p className={`${HAND} text-xl text-[#526b4f]`}>{t("hero.badge")}</p>
        <h1 className={`${DISPLAY} mt-2 text-5xl font-extrabold leading-[1.03] sm:text-6xl`}>
          {t.rich("hero.title", { br: () => <br />, emph: coralEmph })}
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-[#42606f]">{t("hero.subtitle")}</p>
        {/* The scroll hint. `repeat: Infinity`, so it goes through useStillMotion
            like every other loop on these pages — gating the `animate` prop, never
            the markup, so the still version is a stopped mouse rather than a
            missing one (see spark/useStillMotion.ts). */}
        <motion.div
          aria-hidden
          animate={reduceMotion ? undefined : { y: [0, 8, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          className="mx-auto mt-10 h-10 w-6 rounded-full border-[3px] border-[#17202a]"
        >
          <span className="mx-auto mt-1.5 block h-2 w-1 rounded-full bg-[#17202a]" />
        </motion.div>
      </section>

      {/* ── Timeline ───────────────────────────────────────────── */}
      <div ref={trackRef} className="relative mx-auto max-w-7xl px-6">
        <svg
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 hidden h-full w-[140px] -translate-x-1/2 md:block"
          viewBox="0 0 140 1000"
          preserveAspectRatio="none"
          fill="none"
        >
          <path d={SPINE} stroke="#e7dcc8" strokeWidth="4" strokeLinecap="round" />
          <motion.path d={SPINE} stroke="#d65a4a" strokeWidth="4" strokeLinecap="round" style={{ pathLength }} />
        </svg>

        {STEPS.map((step, i) => (
          <StepRow key={step.key} stepKey={step.key} color={step.color} n={i + 1} index={i} />
        ))}
      </div>

      {/* ── Closing ────────────────────────────────────────────── */}
      <section className="mx-auto mt-8 max-w-3xl px-6 text-center">
        <p className={`${HAND} text-xl text-[#526b4f]`}>{t("closing.tag")}</p>
        <h2 className={`${DISPLAY} mt-2 text-4xl font-extrabold sm:text-5xl`}>
          {t.rich("closing.title", { br: () => <br />, emph: coralEmph })}
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-lg text-[#42606f]">{t("closing.body")}</p>
        <button
          type="button"
          onClick={onSignIn}
          className="mt-8 inline-flex items-center gap-2 rounded-xl border-[3px] border-[#17202a] bg-[#d65a4a] px-6 py-3 text-base font-bold text-white shadow-[4px_4px_0_#17202a] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_#17202a]"
        >
          {t("closing.button")}
          <ArrowRight className="h-5 w-5" />
        </button>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="mt-20 border-t-[3px] border-[#17202a]">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-[17px]">
          <div className="flex items-center gap-2 font-bold">
            <Wordmark size="sm" />
            <span>· {t("footer.tagline")}</span>
          </div>
          <div className="flex items-center gap-5">
            <Link href="/" className="font-bold text-[#42606f] hover:text-[#d65a4a]">
              {t("footer.home")}
            </Link>
            <LandingLangSwitch />
          </div>
        </div>
      </footer>
    </main>
  );
}
