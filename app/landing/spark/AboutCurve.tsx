"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useScroll, useSpring, useTransform } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Wordmark from "./Wordmark";
import { LandingLangSwitch } from "./LandingLangSwitch";
import { ABOUT_STEP_KEYS, StepArt, type AboutStepKey } from "./about-art";
import { aboutStepId, aboutStepRailLabel } from "./about-art/shared";
import { ART_TYPE_SCALE } from "./tokens";
import { useStillMotion } from "./useStillMotion";
import SectionRail, { type RailSection } from "./SectionRail";
import MobileNav, { type NavDestination } from "./sections/MobileNav";
import LegalRow from "./sections/LegalRow";
import { useTranslations } from "next-intl";
import { enterWorkspace } from "@/app/_lib/auth/session-nav";
import { sourceRepoHref } from "@/app/_lib/source-repo";

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
  /* The illustration peaks 10% larger than the copy beside it: same scroll
     progress, same keyframe positions, same spring — only the centre value
     moves (1 → 1.1), so the in-ramp and the linear post-peak decrease keep
     their shape. Measured at 1024/1280/1440: the widest art card at 1.1 still
     stops short of the number-dot column, so the extra size costs no collision
     and `scale` never reflows. The text column stays on `scale`. */
  const artScale = useSpring(useTransform(scrollYProgress, [0, 0.5, 1], [0.74, 1.1, 0.82]), {
    stiffness: 110,
    damping: 26
  });
  const opacity = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0.1, 1, 1, 0.15]);
  const dot = useTransform(scrollYProgress, [0.34, 0.5], [0, 1]);
  const artLeft = index % 2 === 0;

  return (
    /* The anchor the rail and the phone menu jump to. `scroll-mt` keeps the
       row's own top clear of the topbar when a `#step-07` deep link lands
       without the rail's smooth glide. */
    <div
      id={aboutStepId(index)}
      ref={ref}
      className="relative scroll-mt-6 grid min-h-[80vh] items-center gap-6 py-10 md:grid-cols-[1fr_auto_1fr] md:gap-10"
    >
      {/* ART_TYPE_SCALE: the step illustrations are mockups of product UI, so
          they were drawn at product text sizes and ended up a full step smaller
          than the copy beside them. One class on the art column lifts every
          size inside the card; see app/globals.css. */}
      <motion.div
        style={{ scale: artScale, opacity }}
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
  /*
   * The eight phases as navigable destinations — "01 Design" … "08 Hired",
   * built once and spent twice: the desktop rail and the phone menu.
   *
   * /about is one 8-step scroll-drawn line and used to be walkable only by
   * scrolling it: a visitor who came to see what happens at Offer had six
   * phases to get through before finding out it exists. Labels rather than
   * catalog keys, because SectionRail reads the `landing` namespace and this
   * copy lives in `aboutPage`.
   */
  const railSections: RailSection[] = STEPS.map((step, i) => ({
    id: aboutStepId(i),
    label: aboutStepRailLabel(t(`steps.${step.key}.eyebrow`), i)
  }));
  const destinations: NavDestination[] = [
    ...railSections.map((s) => ({ kind: "section" as const, id: s.id, label: s.label })),
    { kind: "page", href: "/", label: t("nav.home") },
    { kind: "page", href: "/market", label: t("nav.market") },
    { kind: "page", href: sourceRepoHref(), label: t("nav.source"), external: true }
  ];

  return (
    <>
    <main className="overflow-x-clip bg-[#fdf8ee] pb-28 text-[#17202a] font-[family-name:var(--font-spark-body)]">
      {/* ── Topbar ─────────────────────────────────────────────── */}
      {/* `relative` anchors MobileNav's disclosure panel (absolute, top-full). */}
      <header className="relative mx-auto flex w-full max-w-7xl items-center justify-between px-6 pt-6">
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
        {/* The same disclosure the landing uses, with /about's OWN destinations
            — the eight timeline phases first, then its sibling pages. Without
            it a phone visitor arriving from the sitemap could reach nothing but
            the sign-in button; without the phases, nothing but a long scroll.
            The rail beside it is `lg:block`, so below that breakpoint this
            disclosure is the only in-page navigation there is. */}
        <MobileNav destinations={destinations} />
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
      {/* `xl:max-w-4xl`, not the 3xl the rest of the page uses: the closing line
          must never wrap, and the widest locale needs more room than 3xl gives.
          Measured on this page at text-lg/Gabarito — de 771px, en 563, cs 520,
          fr 499 — against 720px of content inside a 3xl section. 4xl carries
          848px, so the 771 fits with room to spare; the widening is `xl:`-only
          so nothing below the breakpoint moves. */}
      <section className="mx-auto mt-8 max-w-3xl px-6 text-center xl:max-w-4xl">
        <p className={`${HAND} text-xl text-[#526b4f]`}>{t("closing.tag")}</p>
        <h2 className={`${DISPLAY} mt-2 text-4xl font-extrabold sm:text-5xl`}>
          {t.rich("closing.title", { br: () => <br />, emph: coralEmph })}
        </h2>
        {/* One row from `xl` up in all four locales; below it the line wraps at
            the readable `max-w-lg` measure rather than pushing the page into a
            horizontal scroll (the de string alone is 771px — wider than a 768px
            tablet viewport, so nowrap below `lg` would overflow outright).
            `xl` and not `lg` because that is where the SECTION gets the room:
            it is `max-w-3xl` (720px of content) until `xl:max-w-4xl` widens it
            to 848, and 771 does not fit in 720. (This used to cite the fixed
            rail reserving the rightmost 200px too; the nav is a bottom-right
            dock now and reserves nothing on this line.) */}
        <p className="mx-auto mt-4 max-w-lg text-lg text-[#42606f] xl:max-w-none xl:whitespace-nowrap">
          {t("closing.body")}
        </p>
        <button
          type="button"
          onClick={onSignIn}
          className="mt-8 inline-flex items-center gap-2 rounded-xl border-[3px] border-[#17202a] bg-[#d65a4a] px-6 py-3 text-base font-bold text-white shadow-[4px_4px_0_#17202a] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_#17202a]"
        >
          {t("closing.button")}
          {/* Decorative: the button already says where it goes, so the icon is
              a second, unnamed announcement to a screen reader. */}
          <ArrowRight className="h-5 w-5" aria-hidden />
        </button>
      </section>

      {/* The you-are-here nav, the same component the homepage renders — it
          reveals past the hero, follows scroll position, and glides rather
          than jump-cuts. Inside <main> like the landing's (SparkLanding.tsx):
          it is `fixed`, so the surrounding `overflow-x-clip` does not box it. */}
      {/* `placement="adaptive"`, not the homepage's plain rail. The rail is
          vertically centred and so are these step illustrations, and this page
          has no gutter to park it in below 1696px: the art card fills its grid
          column, so its painted right edge lands 5.2px from the viewport edge
          at 1024 and 7.9px at 1280. The rail sat ON the right-hand steps by
          194.8px / 192.1px / 112.1px at 1024 / 1280 / 1440. Reserving its band
          instead would have cut the art column to 301px at 1024 (from 400) and
          425px at 1280 (from 512) — smaller than before the art was enlarged.
          From 1696px up the gutter is real and the rail is what renders, with
          15.9px of clearance that no longer changes with width; below it the
          bottom-right dock takes over. The full reasoning, with the numbers
          that ruled out every other position, is in SectionRail.tsx's header. */}
      {/* 12.5rem, not the homepage's 9.25rem: the widest label here is a
          translated phase name ("05 Pracovní ukázka", "05 Travail pratique").
          It sets the rail's clamped right edge, the width the dock's pill holds
          on every step, AND — through gutterMinRem — the 1696px crossover. */}
      <SectionRail sections={railSections} widthRem={12.5} placement="adaptive" />
    </main>
      {/* Footer: OUTSIDE <main> so it keeps its contentinfo landmark - a footer inside main,
          article or section has no role, and the public-pages spec (and screen readers)
          look for the landmark. */}
      <footer className="mt-20 border-t-[3px] border-[#17202a] bg-[#fdf8ee] text-[#17202a] font-[family-name:var(--font-spark-body)]">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-[17px]">
          <div className="flex items-center gap-2 font-bold">
            <Wordmark size="sm" />
            <span>· {t("footer.tagline")}</span>
          </div>
          {/* /about is in the sitemap, so it is a front door — and a front door
              owes the policies. The row is the same component the landing
              footer renders (sections/LegalRow.tsx), not a second copy. */}
          <LegalRow />
          <div className="flex items-center gap-5">
            <Link href="/" className="font-bold text-[#42606f] hover:text-[#d65a4a]">
              {t("footer.home")}
            </Link>
            <LandingLangSwitch />
          </div>
        </div>
      </footer>
    </>
  );
}
