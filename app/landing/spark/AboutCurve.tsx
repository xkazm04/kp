"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useScroll, useSpring, useTransform } from "framer-motion";
import { ArrowRight } from "lucide-react";
import KandidateMark from "../_components/KandidateMark";
import { LandingLangSwitch } from "./LandingLangSwitch";
import { StepArt, type AboutStepKey } from "./aboutIllustrations";
import { useTranslations } from "next-intl";
import { DEV_GATE, signInDev } from "@/app/_lib/auth/devAuth";

/*
 * /about — the public concept introduction as a scroll-drawn curved timeline of
 * the seven pipeline phases the app actually walks (SIM_PHASES). Same Spark art
 * direction as the home landing (literal hexes — the docs/DESIGN.md exemption);
 * all copy resolves through the `aboutPage` i18n namespace. The spine draws with
 * scroll and each step grows to full size at centre, then shrinks as it passes.
 */
const DISPLAY = "font-[family-name:var(--font-spark-display)]";
const HAND = "font-[family-name:var(--font-spark-hand)]";

// Structural only — eyebrow/title/body come from aboutPage.steps.<key>.
const STEPS: { key: AboutStepKey; color: string }[] = [
  { key: "design", color: "#42606f" },
  { key: "source", color: "#caa54c" },
  { key: "intake", color: "#d65a4a" },
  { key: "screen", color: "#526b4f" },
  { key: "interview", color: "#d65a4a" },
  { key: "offer", color: "#caa54c" },
  { key: "hired", color: "#526b4f" }
];

// Serpentine spine crossing centre (x=70) at each of the seven node rows
// (y ≈ 71, 214, … 929 in this 0–1000 viewBox), weaving right/left between them.
const SPINE = [
  "M70 0",
  "C 116 24, 116 48, 70 71",
  "C 24 119, 24 167, 70 214",
  "C 116 262, 116 310, 70 357",
  "C 24 405, 24 452, 70 500",
  "C 116 548, 116 595, 70 643",
  "C 24 690, 24 738, 70 786",
  "C 116 833, 116 881, 70 929",
  "C 70 953, 70 977, 70 1000"
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
      <motion.div style={{ scale, opacity }} className={`flex justify-center ${artLeft ? "md:order-1" : "md:order-3"}`}>
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
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ["start center", "end end"] });
  const pathLength = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });
  const onSignIn = () => (DEV_GATE ? signInDev() : window.location.assign("/login"));
  const coralEmph = (chunks: React.ReactNode) => <span className="text-[#d65a4a]">{chunks}</span>;

  return (
    <main className="overflow-x-clip bg-[#fdf8ee] pb-28 text-[#17202a] font-[family-name:var(--font-spark-body)]">
      {/* ── Topbar ─────────────────────────────────────────────── */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 pt-6">
        <Link href="/" className="flex items-center gap-3">
          <KandidateMark className="h-10 w-10 text-[#d65a4a] [--k-fg:#fdf8ee] [--k-accent:#17202a]" />
          <span className={`${DISPLAY} text-2xl font-bold`}>
            Kandi<span className="text-[#d65a4a]">D</span>ate
          </span>
        </Link>
        <nav className="hidden items-center gap-6 text-[15px] font-bold sm:flex">
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
        <motion.div
          aria-hidden
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          className="mx-auto mt-10 h-10 w-6 rounded-full border-[3px] border-[#17202a]"
        >
          <span className="mx-auto mt-1.5 block h-2 w-1 rounded-full bg-[#17202a]" />
        </motion.div>
      </section>

      {/* ── Timeline ───────────────────────────────────────────── */}
      <div ref={trackRef} className="relative mx-auto max-w-5xl px-6">
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
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-[15px]">
          <div className="flex items-center gap-2 font-bold">
            <KandidateMark className="h-7 w-7 text-[#17202a] [--k-fg:#fdf8ee]" />
            KandiDate · {t("footer.tagline")}
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
