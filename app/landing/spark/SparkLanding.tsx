"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  CalendarCheck,
  Eye,
  FileSearch,
  Gauge,
  Inbox,
  Languages,
  Mic,
  ShieldCheck,
  Sparkles,
  Stamp
} from "lucide-react";
import KandidateMark from "../_components/KandidateMark";
import { FeatureSpotlight, type PreviewKey } from "./FeaturePreviews";
import PricingSection from "./PricingSection";
import { BTN, DISPLAY, HAND, STICKER } from "./tokens";

/*
 * Variant A — "Spark". Sticker-sheet maximalism: thick ink outlines, hard
 * offset shadows, rotated badges, a clay mascot and two signature
 * interactions — stamp the CV pile, and peek inside any feature card to pop
 * open its live product spotlight. Fixed art direction → literal hexes.
 */
const MARQUEE_ITEMS = [
  "CV scoring in seconds",
  "AI voice interviews",
  "self-scheduling links",
  "five channels, one pipeline",
  "salary radar",
  "human-approved decisions",
  "Czech + English",
  "offer portals"
];

const PILE = [
  { name: "Jana N.", role: "React Developer", score: 87, color: "#526b4f", verdict: "strong fit" },
  { name: "Petr K.", role: "Data Analyst", score: 64, color: "#caa54c", verdict: "worth a call" },
  { name: "Alex T.", role: "PM, no portfolio", score: 31, color: "#d65a4a", verdict: "kind pass" }
] as const;

const STEPS = [
  {
    n: "1",
    title: "Drop the pile",
    body: "Every CV gets read — really read. KandiDate scores fit against your job description with an evidence-backed rubric, not keyword bingo. Strengths, gaps and a salary estimate included.",
    color: "#d65a4a"
  },
  {
    n: "2",
    title: "Let it talk",
    body: "Promising candidates get a friendly AI voice interview within hours, not weeks. Real questions built from their CV, live transcript, structured scorecard at the end.",
    color: "#caa54c"
  },
  {
    n: "3",
    title: "You make the call",
    body: "Nothing ships without you. Every screen, shortlist and offer waits at a human gate with the reasoning attached. Approve, override, or send it back.",
    color: "#526b4f"
  }
] as const;

const FEATURES: ReadonlyArray<{
  icon: typeof FileSearch;
  title: string;
  body: string;
  rotate: number;
  preview: PreviewKey;
}> = [
  {
    icon: FileSearch,
    title: "Job-fit scoring",
    body: "0–100 fit score per CV with the evidence to back it up. Multiple CV versions? Compare them side by side.",
    rotate: -1.5,
    preview: "score"
  },
  {
    icon: Mic,
    title: "Voice screening",
    body: "An AI interviewer that asks about their actual experience — in Czech or English — and writes the scorecard for you.",
    rotate: 1,
    preview: "voice"
  },
  {
    icon: CalendarCheck,
    title: "Self-scheduling",
    body: "Candidates pick their own slot from a link. No reply-all calendar tennis, no ghosted timezones.",
    rotate: -1,
    preview: "schedule"
  },
  {
    icon: Inbox,
    title: "One inbox, five doors",
    body: "Apply portal, email, job boards, sourcing and manual adds all land in one pipeline at the same starting line.",
    rotate: 1.5,
    preview: "inbox"
  },
  {
    icon: Gauge,
    title: "Salary radar",
    body: "Market-grounded salary bands for the Czech market, adjusted to company type — so your offer lands the first time.",
    rotate: -1.5,
    preview: "salary"
  },
  {
    icon: ShieldCheck,
    title: "Gates & receipts",
    body: "A full audit trail and a kill switch. AI recommends, humans decide, and every decision keeps its receipt.",
    rotate: 1,
    preview: "gates"
  }
];

const TRANSCRIPT = [
  { who: "ai", text: "You shipped a React app for a school project — what broke first when real users hit it?" },
  { who: "them", text: "Honestly? The state management. I rewrote it twice before I understood why…" },
  { who: "ai", text: "Love it. Walk me through the second rewrite." }
] as const;

const CONFETTI = [
  { className: "left-[6%] top-[18%] h-3 w-3 rounded-full bg-[#caa54c]", delay: 0 },
  { className: "left-[12%] top-[64%] h-2.5 w-2.5 rotate-12 bg-[#d65a4a]", delay: 0.8 },
  { className: "right-[10%] top-[12%] h-3 w-3 rotate-45 bg-[#526b4f]", delay: 0.4 },
  { className: "right-[20%] top-[70%] h-2 w-2 rounded-full bg-[#42606f]", delay: 1.2 },
  { className: "left-[44%] top-[8%] h-2 w-6 rounded-full bg-[#dce7d0]", delay: 1.6 }
] as const;

function StampableCv({ card, index }: { card: (typeof PILE)[number]; index: number }) {
  const [stamped, setStamped] = useState(false);
  return (
    <motion.button
      type="button"
      onHoverStart={() => setStamped(true)}
      onClick={() => setStamped((s) => !s)}
      initial={{ opacity: 0, y: 24, rotate: 0 }}
      animate={{ opacity: 1, y: 0, rotate: index * 2 - 2 }}
      transition={{ delay: 0.5 + index * 0.12, type: "spring", bounce: 0.4 }}
      className={`${STICKER} relative w-44 cursor-pointer p-4 text-left focus-ring`}
      aria-pressed={stamped}
      aria-label={`Score the CV of ${card.name}`}
    >
      <p className="text-[15px] font-bold text-[#17202a]">{card.name}</p>
      <p className="text-sm text-[#42606f]">{card.role}</p>
      <div className="mt-3 space-y-1.5">
        <div className="h-1.5 w-full rounded bg-[#dce7d0]" />
        <div className="h-1.5 w-4/5 rounded bg-[#dce7d0]" />
        <div className="h-1.5 w-3/5 rounded bg-[#dce7d0]" />
      </div>
      <motion.span
        initial={false}
        animate={stamped ? { scale: 1, opacity: 1, rotate: -10 } : { scale: 2.4, opacity: 0, rotate: 8 }}
        transition={{ type: "spring", bounce: 0.45, duration: 0.45 }}
        className="pointer-events-none absolute -right-3 -top-3 grid h-14 w-14 place-items-center rounded-full border-[3px] border-[#17202a] text-white shadow-[3px_3px_0_#17202a]"
        style={{ background: card.color }}
      >
        <span className={`${DISPLAY} text-lg font-bold leading-none`}>{card.score}</span>
      </motion.span>
      <motion.span
        initial={false}
        animate={stamped ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
        transition={{ delay: 0.1 }}
        className="mt-3 inline-block text-sm font-bold"
        style={{ color: card.color }}
      >
        {card.verdict}
      </motion.span>
    </motion.button>
  );
}

export default function SparkLanding() {
  const reduceMotion = useReducedMotion();
  const [preview, setPreview] = useState<PreviewKey | null>(null);
  const [pinned, setPinned] = useState(false);
  // Closing the spotlight while the cursor sits on a card makes the browser
  // re-fire hover on that card the instant the overlay unmounts — which would
  // reopen what the user just dismissed. Ignore hover-opens for a beat.
  const suppressHoverUntil = useRef(0);

  const closePreview = useCallback(() => {
    setPreview(null);
    setPinned(false);
    suppressHoverUntil.current = Date.now() + 350;
  }, []);

  const hoverOpen = useCallback(
    (key: PreviewKey) => {
      if (pinned || Date.now() < suppressHoverUntil.current) return;
      setPreview(key);
    },
    [pinned]
  );

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePreview();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, closePreview]);

  return (
    <main
      className={`min-h-screen overflow-x-clip bg-[#fdf8ee] text-[#17202a] font-[family-name:var(--font-spark-body)]`}
    >
      {/* ── Topbar ─────────────────────────────────────────────── */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 pt-6">
        <div className="flex items-center gap-3">
          <KandidateMark className="h-10 w-10 text-[#d65a4a] [--k-fg:#fdf8ee] [--k-accent:#17202a]" />
          <span className={`${DISPLAY} text-2xl font-bold`}>
            Kandi<span className="text-[#d65a4a]">D</span>ate
          </span>
        </div>
        <nav className="hidden items-center gap-6 text-[15px] font-bold sm:flex">
          <a href="#how" className="hover:text-[#d65a4a]">
            How it works
          </a>
          <a href="#features" className="hover:text-[#d65a4a]">
            Features
          </a>
          <a href="#pricing" className="hover:text-[#d65a4a]">
            Pricing
          </a>
          <a
            href="#cta"
            className="rounded-lg border-[3px] border-[#17202a] bg-[#caa54c] px-4 py-2 shadow-[3px_3px_0_#17202a] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_#17202a]"
          >
            Get early access
          </a>
        </nav>
      </header>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="relative mx-auto grid w-full max-w-6xl gap-10 px-6 pb-20 pt-14 lg:grid-cols-[1.15fr_0.85fr] lg:gap-4">
        {!reduceMotion &&
          CONFETTI.map((c, i) => (
            <motion.span
              key={i}
              aria-hidden
              className={`pointer-events-none absolute ${c.className}`}
              animate={{ y: [0, -14, 0], rotate: [0, 18, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: c.delay }}
            />
          ))}

        <div className="relative z-10">
          <motion.span
            initial={{ opacity: 0, y: 16, rotate: -3 }}
            animate={{ opacity: 1, y: 0, rotate: -2 }}
            transition={{ type: "spring", bounce: 0.5 }}
            className="inline-flex items-center gap-2 rounded-full border-[3px] border-[#17202a] bg-[#dce7d0] px-4 py-1.5 text-[15px] font-bold shadow-[3px_3px_0_#17202a]"
          >
            <Sparkles className="h-4 w-4" />
            AI for hiring that keeps humans in charge
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, type: "spring", bounce: 0.3 }}
            className={`${DISPLAY} mt-6 text-5xl font-extrabold leading-[1.02] sm:text-7xl`}
          >
            Hiring that
            <br />
            actually{" "}
            <span className="relative inline-block text-[#d65a4a]">
              moves
              <svg
                viewBox="0 0 220 14"
                aria-hidden
                className="absolute -bottom-2 left-0 w-full"
                preserveAspectRatio="none"
              >
                <path
                  d="M4 10 C 50 2, 120 2, 216 8"
                  fill="none"
                  stroke="#caa54c"
                  strokeWidth="6"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            .
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.22 }}
            className="mt-6 max-w-xl text-lg leading-relaxed text-[#42606f]"
          >
            KandiDate reads every CV, runs the first interview out loud, books the calendar and lines up
            decisions for you to approve. The pile disappears. The judgment stays yours.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.32 }}
            className="mt-8 flex flex-wrap items-center gap-4"
          >
            <a href="#cta" className={`${BTN} bg-[#d65a4a] text-white`}>
              Start screening free
              <ArrowRight className="h-5 w-5" />
            </a>
            <a href="#voice" className={`${BTN} bg-white`}>
              <Mic className="h-5 w-5 text-[#d65a4a]" />
              Hear it interview
            </a>
          </motion.div>

          <div className="relative mt-12">
            <p className={`${HAND} mb-3 -rotate-1 text-lg text-[#526b4f]`}>try it — hover the pile ↓</p>
            <div className="flex flex-wrap gap-4">
              {PILE.map((card, i) => (
                <StampableCv key={card.name} card={card} index={i} />
              ))}
            </div>
          </div>
        </div>

        <div className="relative flex items-center justify-center">
          <motion.div
            aria-hidden
            className="absolute h-72 w-72 rounded-full bg-[#dce7d0] sm:h-96 sm:w-96"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", bounce: 0.4, delay: 0.15 }}
          />
          <motion.div
            animate={reduceMotion ? undefined : { y: [0, -14, 0] }}
            transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
            className="relative z-10"
          >
            <Image
              src="/landing/spark-mascot.png"
              alt="Kandi, the KandiDate mascot, cheering under an approved CV"
              width={460}
              height={460}
              priority
              className="drop-shadow-[0_24px_32px_rgba(23,32,42,0.18)]"
            />
          </motion.div>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9 }}
            className={`${HAND} absolute -bottom-2 right-2 rotate-2 text-xl text-[#42606f] sm:right-10`}
          >
            meet Kandi — your new teammate
          </motion.p>
        </div>
      </section>

      {/* ── Marquee ────────────────────────────────────────────── */}
      <div className="overflow-hidden border-y-[3px] border-[#17202a] bg-[#d65a4a] py-3">
        <motion.div
          className="flex w-max items-center gap-10 whitespace-nowrap pr-10"
          animate={reduceMotion ? undefined : { x: ["0%", "-50%"] }}
          transition={{ duration: 26, ease: "linear", repeat: Infinity }}
        >
          {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((item, i) => (
            <span key={i} className={`${DISPLAY} flex items-center gap-10 text-lg font-bold text-[#fdf8ee]`}>
              {item}
              <Sparkles aria-hidden className="h-4 w-4 text-[#caa54c]" />
            </span>
          ))}
        </motion.div>
      </div>

      {/* ── Three steps ────────────────────────────────────────── */}
      <section id="how" className="mx-auto w-full max-w-6xl px-6 py-24">
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          className={`${DISPLAY} text-4xl font-extrabold sm:text-5xl`}
        >
          From pile to shortlist
          <br />
          in <span className="text-[#d65a4a]">three moves</span>
        </motion.h2>

        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <motion.article
              key={step.n}
              initial={{ opacity: 0, y: 32, rotate: 0 }}
              whileInView={{ opacity: 1, y: 0, rotate: i === 1 ? 1 : -1 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: i * 0.12, type: "spring", bounce: 0.35 }}
              whileHover={{ rotate: 0, scale: 1.02 }}
              className={`${STICKER} p-7`}
            >
              <span
                className={`${DISPLAY} grid h-12 w-12 place-items-center rounded-full border-[3px] border-[#17202a] text-xl font-extrabold text-white shadow-[3px_3px_0_#17202a]`}
                style={{ background: step.color }}
              >
                {step.n}
              </span>
              <h3 className={`${DISPLAY} mt-5 text-2xl font-bold`}>{step.title}</h3>
              <p className="mt-3 leading-relaxed text-[#42606f]">{step.body}</p>
            </motion.article>
          ))}
        </div>
      </section>

      {/* ── Feature stickers + spotlights ──────────────────────── */}
      <section id="features" className="border-y-[3px] border-[#17202a] bg-[#dce7d0] py-24">
        <div className="mx-auto w-full max-w-6xl px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <motion.h2
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              className={`${DISPLAY} text-4xl font-extrabold sm:text-5xl`}
            >
              The whole funnel,
              <br />
              one happy place
            </motion.h2>
            <p className={`${HAND} max-w-xs rotate-1 text-lg text-[#526b4f]`}>
              hover any card for a live peek — it all ships today, no asterisks
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                role="button"
                tabIndex={0}
                aria-haspopup="dialog"
                aria-expanded={preview === f.preview}
                onHoverStart={() => hoverOpen(f.preview)}
                onHoverEnd={() => {
                  if (!pinned) setPreview(null);
                }}
                onClick={() => {
                  setPreview(f.preview);
                  setPinned(true);
                }}
                onFocus={() => hoverOpen(f.preview)}
                onBlur={() => {
                  if (!pinned) setPreview(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPreview(f.preview);
                    setPinned(true);
                  }
                }}
                initial={{ opacity: 0, y: 28 }}
                whileInView={{ opacity: 1, y: 0, rotate: f.rotate }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ delay: (i % 3) * 0.1, type: "spring", bounce: 0.3 }}
                whileHover={{ rotate: 0, y: -6 }}
                className={`${STICKER} group cursor-pointer p-6 text-left focus-ring`}
              >
                <span className="inline-grid h-11 w-11 place-items-center rounded-xl border-[3px] border-[#17202a] bg-[#fdf8ee] shadow-[3px_3px_0_#17202a]">
                  <f.icon className="h-5 w-5 text-[#d65a4a]" />
                </span>
                <h3 className={`${DISPLAY} mt-4 text-xl font-bold`}>{f.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[#42606f]">{f.body}</p>
                <span
                  className={`${HAND} mt-3 inline-flex items-center gap-1.5 text-[15px] text-[#d65a4a] opacity-70 transition-opacity group-hover:opacity-100`}
                >
                  <Eye className="h-4 w-4" aria-hidden />
                  peek inside
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Voice teaser ───────────────────────────────────────── */}
      <section id="voice" className="mx-auto w-full max-w-6xl px-6 py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <motion.h2
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              className={`${DISPLAY} text-4xl font-extrabold sm:text-5xl`}
            >
              It doesn’t just read CVs.
              <br />
              It <span className="text-[#d65a4a]">talks</span> to people.
            </motion.h2>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-[#42606f]">
              First-round screens happen the same day someone applies — a warm, structured voice interview
              built from their actual CV. Candidates get heard. You get a transcript and a scorecard instead
              of a calendar full of thirty-minute maybes.
            </p>
            <ul className="mt-6 space-y-3 text-base font-bold">
              {["Czech and English, their choice", "Questions grounded in their experience", "Live transcript, structured scorecard"].map(
                (li) => (
                  <li key={li} className="flex items-center gap-3">
                    <span className="grid h-7 w-7 place-items-center rounded-full border-[3px] border-[#17202a] bg-[#caa54c] shadow-[2px_2px_0_#17202a]">
                      <Stamp className="h-3.5 w-3.5" />
                    </span>
                    {li}
                  </li>
                )
              )}
            </ul>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 32, rotate: 2 }}
            whileInView={{ opacity: 1, y: 0, rotate: 1 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ type: "spring", bounce: 0.3 }}
            className={`${STICKER} p-6`}
          >
            <div className="flex items-center justify-between border-b-[3px] border-dashed border-[#dce7d0] pb-4">
              <div className="flex items-center gap-3">
                <span className="relative grid h-10 w-10 place-items-center rounded-full border-[3px] border-[#17202a] bg-[#d65a4a]">
                  <Mic className="h-4 w-4 text-white" />
                </span>
                <div>
                  <p className="text-[15px] font-bold">First-round screen</p>
                  <p className="text-sm text-[#42606f]">live · 4 min 12 s</p>
                </div>
              </div>
              <span className="flex h-6 items-end gap-1" aria-hidden>
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="voice-eq-bar w-1.5 rounded bg-[#526b4f]"
                    style={{ height: "100%", animationDelay: `${delay}ms` }}
                  />
                ))}
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {TRANSCRIPT.map((line, i) => (
                <motion.p
                  key={i}
                  initial={{ opacity: 0, x: line.who === "ai" ? -16 : 16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.3 + i * 0.25 }}
                  className={`max-w-[85%] rounded-2xl border-[3px] border-[#17202a] px-4 py-2.5 text-[15px] leading-snug ${
                    line.who === "ai"
                      ? "bg-[#fdf8ee]"
                      : "ml-auto bg-[#dce7d0]"
                  }`}
                >
                  {line.text}
                </motion.p>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────────── */}
      <PricingSection />

      {/* ── CTA ────────────────────────────────────────────────── */}
      <section id="cta" className="mx-auto w-full max-w-6xl px-6 py-24">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          className="relative overflow-hidden rounded-3xl border-[3px] border-[#17202a] bg-[#d65a4a] px-8 py-16 text-center shadow-[8px_8px_0_#17202a]"
        >
          <span aria-hidden className="absolute -left-6 -top-6 h-24 w-24 rounded-full bg-[#caa54c] opacity-60" />
          <span aria-hidden className="absolute -bottom-8 -right-8 h-32 w-32 rotate-12 rounded-3xl bg-[#526b4f] opacity-40" />
          <h2 className={`${DISPLAY} relative text-4xl font-extrabold text-[#fdf8ee] sm:text-5xl`}>
            Your next great hire
            <br />
            is buried in that pile.
          </h2>
          <p className="relative mx-auto mt-4 max-w-md text-lg text-[#fdf8ee]/90">
            Let KandiDate dig them out. Free while we’re in early access.
          </p>
          <motion.a
            href="#"
            whileHover={{ scale: 1.04, rotate: -1 }}
            whileTap={{ scale: 0.97 }}
            className={`${BTN} relative mt-8 bg-[#fdf8ee]`}
          >
            Get early access
            <ArrowRight className="h-5 w-5 text-[#d65a4a]" />
          </motion.a>
          <p className={`${HAND} relative mt-5 text-base text-[#fdf8ee]/80`}>no credit card, no robots in charge</p>
        </motion.div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="border-t-[3px] border-[#17202a] bg-[#fdf8ee]">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-[15px]">
          <div className="flex items-center gap-2 font-bold">
            <KandidateMark className="h-7 w-7 text-[#17202a] [--k-fg:#fdf8ee]" />
            KandiDate · AI for hiring, humans for decisions
          </div>
          <div className="flex items-center gap-4 text-[#42606f]">
            <Languages className="h-4 w-4" aria-hidden />
            <span>EN · CS</span>
          </div>
        </div>
      </footer>

      <FeatureSpotlight preview={preview} pinned={pinned} onClose={closePreview} />
    </main>
  );
}
