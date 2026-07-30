"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  CalendarCheck,
  Eye,
  FileSearch,
  FileSignature,
  FlaskConical,
  Gauge,
  History,
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
import { enterWorkspace } from "@/app/_lib/auth/session-nav";
import { LandingLangSwitch } from "./LandingLangSwitch";

/*
 * Variant A — "Spark". Sticker-sheet maximalism: thick ink outlines, hard
 * offset shadows, rotated badges, a clay mascot and two signature
 * interactions — stamp the CV pile, and peek inside any feature card to pop
 * open its live product spotlight. Fixed art direction → literal hexes.
 */
// Structural data only — every visible string now resolves through the
// `landing` i18n namespace (messages/{en,cs}.json). These arrays carry the
// stable keys, icons, colours and layout knobs the translated copy hangs off.
const PILE = [
  { key: "jana", name: "Jana N.", score: 87, color: "#526b4f" },
  { key: "petr", name: "Petr K.", score: 64, color: "#caa54c" },
  { key: "alex", name: "Alex T.", score: 31, color: "#d65a4a" }
] as const;

const STEPS = [
  { key: "drop", color: "#d65a4a" },
  { key: "talk", color: "#caa54c" },
  { key: "call", color: "#526b4f" }
] as const;

// Nine cards, three clean rows — and, more to the point, the grid now matches the app.
// `cases` (verified work-sample), `rediscover` and `offer` were all shipped and all
// missing from the shop window; `cases` sits third rather than last because it is the
// capability nobody else sells, not an afterthought.
const FEATURES = [
  { icon: FileSearch, rotate: -1.5, preview: "score" },
  { icon: Mic, rotate: 1, preview: "voice" },
  { icon: FlaskConical, rotate: -1, preview: "cases" },
  { icon: CalendarCheck, rotate: 1.5, preview: "schedule" },
  { icon: Inbox, rotate: -1.5, preview: "inbox" },
  { icon: Gauge, rotate: 1, preview: "salary" },
  { icon: History, rotate: -1, preview: "rediscover" },
  { icon: FileSignature, rotate: 1.5, preview: "offer" },
  { icon: ShieldCheck, rotate: -1.5, preview: "gates" }
] as const satisfies ReadonlyArray<{ icon: typeof FileSearch; rotate: number; preview: PreviewKey }>;

// Responsible-AI pillars (UAT B2): the public compliance story a regulated buyer
// needs before they'll pilot. Copy resolves through landing.trust.*; the icons
// reuse the ones already imported for the feature stickers.
const COMPLIANCE = [
  { key: "human", icon: ShieldCheck, color: "#526b4f" },
  { key: "oversight", icon: Eye, color: "#42606f" },
  { key: "gdpr", icon: FileSearch, color: "#d65a4a" },
  { key: "audit", icon: Gauge, color: "#caa54c" }
] as const;

// Who speaks each transcript line; the words come from landing.voice.transcript.
const TRANSCRIPT_WHO = ["ai", "them", "ai"] as const;

const CONFETTI = [
  { className: "left-[6%] top-[18%] h-3 w-3 rounded-full bg-[#caa54c]", delay: 0 },
  { className: "left-[12%] top-[64%] h-2.5 w-2.5 rotate-12 bg-[#d65a4a]", delay: 0.8 },
  { className: "right-[10%] top-[12%] h-3 w-3 rotate-45 bg-[#526b4f]", delay: 0.4 },
  { className: "right-[20%] top-[70%] h-2 w-2 rounded-full bg-[#42606f]", delay: 1.2 },
  { className: "left-[44%] top-[8%] h-2 w-6 rounded-full bg-[#dce7d0]", delay: 1.6 }
] as const;

function StampableCv({ card, index }: { card: (typeof PILE)[number]; index: number }) {
  const t = useTranslations("landing");
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
      aria-label={t("hero.scoreCardAria", { name: card.name })}
    >
      <p className="text-[15px] font-bold text-[#17202a]">{card.name}</p>
      <p className="text-sm text-[#42606f]">{t(`pile.${card.key}.role`)}</p>
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
        {t(`pile.${card.key}.verdict`)}
      </motion.span>
    </motion.button>
  );
}

export default function SparkLanding() {
  const reduceMotion = useReducedMotion();
  const t = useTranslations("landing");
  // Arrays come back raw from the catalog (next-intl returns them verbatim).
  const marquee = t.raw("marquee") as string[];
  const voiceBullets = t.raw("voice.bullets") as string[];
  const transcript = t.raw("voice.transcript") as string[];
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
            {t("nav.how")}
          </a>
          <a href="#features" className="hover:text-[#d65a4a]">
            {t("nav.features")}
          </a>
          <a href="#pricing" className="hover:text-[#d65a4a]">
            {t("nav.pricing")}
          </a>
          <a href="/about" className="hover:text-[#d65a4a]">
            {t("nav.about")}
          </a>
          <a href="/market" className="hover:text-[#d65a4a]">
            {t("nav.market")}
          </a>
          {/* Sign in — the app ships open to all, so this is the single entry
              point. In development it flips the localStorage gate and drops you
              straight into the dashboard; in production it hands off to the real
              password sign-in. */}
          <button
            type="button"
            onClick={() => void enterWorkspace()}
            className="rounded-lg border-[3px] border-[#17202a] bg-[#caa54c] px-4 py-2 shadow-[3px_3px_0_#17202a] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_#17202a]"
          >
            {t("nav.signIn")}
          </button>
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
            {t("hero.badge")}
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, type: "spring", bounce: 0.3 }}
            className={`${DISPLAY} mt-6 text-5xl font-extrabold leading-[1.02] sm:text-7xl`}
          >
            {t.rich("hero.title", {
              br: () => <br />,
              emph: (chunks) => (
                <span className="relative inline-block text-[#d65a4a]">
                  {chunks}
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
              )
            })}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.22 }}
            className="mt-6 max-w-xl text-lg leading-relaxed text-[#42606f]"
          >
            {t("hero.subtitle")}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.32 }}
            className="mt-8 flex flex-wrap items-center gap-4"
          >
            <button
              type="button"
              onClick={() => void enterWorkspace()}
              className={`${BTN} bg-[#d65a4a] text-white`}
            >
              {t("hero.ctaPrimary")}
              <ArrowRight className="h-5 w-5" />
            </button>
            {/* Public guided demo (B1): a plain navigation to /api/demo mints an
                isolated demo-workspace session and lands on /?sim=auto, which
                auto-plays the JD→Hired run — no login, no key. */}
            <a href="/api/demo" className={`${BTN} bg-white`}>
              {t("hero.ctaDemo")}
              <ArrowRight className="h-5 w-5 text-[#d65a4a]" />
            </a>
            <a href="#voice" className={`${BTN} bg-white`}>
              <Mic className="h-5 w-5 text-[#d65a4a]" />
              {t("hero.ctaSecondary")}
            </a>
          </motion.div>

          <div className="relative mt-12">
            <p className={`${HAND} mb-3 -rotate-1 text-lg text-[#526b4f]`}>{t("hero.pileHint")}</p>
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
              alt={t("hero.mascotAlt")}
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
            {t("hero.mascotNote")}
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
          {[...marquee, ...marquee].map((item, i) => (
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
          {t.rich("steps.heading", {
            br: () => <br />,
            emph: (chunks) => <span className="text-[#d65a4a]">{chunks}</span>
          })}
        </motion.h2>

        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <motion.article
              key={step.key}
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
                {i + 1}
              </span>
              <h3 className={`${DISPLAY} mt-5 text-2xl font-bold`}>{t(`steps.${step.key}.title`)}</h3>
              <p className="mt-3 leading-relaxed text-[#42606f]">{t(`steps.${step.key}.body`)}</p>
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
              {t.rich("features.heading", { br: () => <br /> })}
            </motion.h2>
            <p className={`${HAND} max-w-xs rotate-1 text-lg text-[#526b4f]`}>
              {t("features.hint")}
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.preview}
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
                <h3 className={`${DISPLAY} mt-4 text-xl font-bold`}>{t(`features.${f.preview}.title`)}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[#42606f]">{t(`features.${f.preview}.body`)}</p>
                <span
                  className={`${HAND} mt-3 inline-flex items-center gap-1.5 text-[15px] text-[#d65a4a] opacity-70 transition-opacity group-hover:opacity-100`}
                >
                  <Eye className="h-4 w-4" aria-hidden />
                  {t("features.peekInside")}
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
              {t.rich("voice.heading", {
                br: () => <br />,
                emph: (chunks) => <span className="text-[#d65a4a]">{chunks}</span>
              })}
            </motion.h2>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-[#42606f]">
              {t("voice.body")}
            </p>
            <ul className="mt-6 space-y-3 text-base font-bold">
              {voiceBullets.map((li) => (
                <li key={li} className="flex items-center gap-3">
                  <span className="grid h-7 w-7 place-items-center rounded-full border-[3px] border-[#17202a] bg-[#caa54c] shadow-[2px_2px_0_#17202a]">
                    <Stamp className="h-3.5 w-3.5" />
                  </span>
                  {li}
                </li>
              ))}
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
                  <p className="text-[15px] font-bold">{t("voice.cardTitle")}</p>
                  <p className="text-sm text-[#42606f]">{t("voice.cardMeta")}</p>
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
              {transcript.map((text, i) => {
                const who = TRANSCRIPT_WHO[i];
                return (
                  <motion.p
                    key={i}
                    initial={{ opacity: 0, x: who === "ai" ? -16 : 16 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.3 + i * 0.25 }}
                    className={`max-w-[85%] rounded-2xl border-[3px] border-[#17202a] px-4 py-2.5 text-[15px] leading-snug ${
                      who === "ai" ? "bg-[#fdf8ee]" : "ml-auto bg-[#dce7d0]"
                    }`}
                  >
                    {text}
                  </motion.p>
                );
              })}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Responsible AI / compliance (UAT B2) ───────────────── */}
      <section id="trust" className="border-y-[3px] border-[#17202a] bg-[#fdf8ee] py-24">
        <div className="mx-auto w-full max-w-6xl px-6">
          <motion.h2
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            className={`${DISPLAY} text-4xl font-extrabold sm:text-5xl`}
          >
            {t.rich("trust.heading", {
              br: () => <br />,
              emph: (chunks) => <span className="text-[#d65a4a]">{chunks}</span>
            })}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            className="mt-5 max-w-2xl text-lg leading-relaxed text-[#42606f]"
          >
            {t("trust.subtitle")}
          </motion.p>
          <div className="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {COMPLIANCE.map((pillar, i) => (
              <motion.article
                key={pillar.key}
                initial={{ opacity: 0, y: 32 }}
                whileInView={{ opacity: 1, y: 0, rotate: i % 2 === 0 ? -1 : 1 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ delay: i * 0.1, type: "spring", bounce: 0.35 }}
                whileHover={{ rotate: 0, scale: 1.02 }}
                className={`${STICKER} p-7`}
              >
                <span
                  className="grid h-12 w-12 place-items-center rounded-full border-[3px] border-[#17202a] text-white shadow-[3px_3px_0_#17202a]"
                  style={{ background: pillar.color }}
                >
                  <pillar.icon className="h-6 w-6" aria-hidden />
                </span>
                <h3 className={`${DISPLAY} mt-5 text-xl font-bold`}>{t(`trust.${pillar.key}.title`)}</h3>
                <p className="mt-3 leading-relaxed text-[#42606f]">{t(`trust.${pillar.key}.body`)}</p>
              </motion.article>
            ))}
          </div>
          <p className="mt-8 text-sm italic text-[#42606f]">{t("trust.footnote")}</p>
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
            {t.rich("cta.heading", { br: () => <br /> })}
          </h2>
          <p className="relative mx-auto mt-4 max-w-md text-lg text-[#fdf8ee]/90">
            {t("cta.body")}
          </p>
          <motion.button
            type="button"
            onClick={() => void enterWorkspace()}
            whileHover={{ scale: 1.04, rotate: -1 }}
            whileTap={{ scale: 0.97 }}
            className={`${BTN} relative mt-8 bg-[#fdf8ee]`}
          >
            {t("cta.button")}
            <ArrowRight className="h-5 w-5 text-[#d65a4a]" />
          </motion.button>
          <p className={`${HAND} relative mt-5 text-base text-[#fdf8ee]/80`}>{t("cta.note")}</p>
        </motion.div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="border-t-[3px] border-[#17202a] bg-[#fdf8ee]">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-[15px]">
          <div className="flex items-center gap-2 font-bold">
            <KandidateMark className="h-7 w-7 text-[#17202a] [--k-fg:#fdf8ee]" />
            KandiDate · {t("footer.tagline")}
          </div>
          <div className="flex items-center gap-3 text-[#42606f]">
            <Languages className="h-4 w-4" aria-hidden />
            <LandingLangSwitch />
          </div>
        </div>
      </footer>

      <FeatureSpotlight preview={preview} pinned={pinned} onClose={closePreview} />
    </main>
  );
}
