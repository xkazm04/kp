"use client";

import { useState } from "react";
import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ArrowRight, Mic, Sparkles } from "lucide-react";
import { BTN, DISPLAY, HAND, STICKER } from "../tokens";
import { enterWorkspace } from "@/app/_lib/auth/session-nav";

/*
 * Hero — headline, the three calls to action, and the signature interaction:
 * a pile of CVs you can stamp a fit score onto.
 *
 * Structural data only below; every visible string resolves through the
 * `landing` namespace.
 */
const PILE = [
  { key: "jana", name: "Jana N.", score: 87, color: "#526b4f" },
  { key: "petr", name: "Petr K.", score: 64, color: "#caa54c" },
  { key: "alex", name: "Alex T.", score: 31, color: "#d65a4a" }
] as const;

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

export default function Hero() {
  const t = useTranslations("landing");
  const reduceMotion = useReducedMotion();
  return (
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
          <Sparkles className="h-4 w-4" aria-hidden />
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
                <svg viewBox="0 0 220 14" aria-hidden className="absolute -bottom-2 left-0 w-full" preserveAspectRatio="none">
                  <path d="M4 10 C 50 2, 120 2, 216 8" fill="none" stroke="#caa54c" strokeWidth="6" strokeLinecap="round" />
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
          {/* TODO(signup-cta): /signup exists but is gated by the server-side
              KP_SIGNUP_ENABLED env (the page 404s when unset), which the client
              cannot detect — so the primary CTA keeps enterWorkspace() (open mode
              → dashboard, password mode → /login). Point it at /signup once the
              gate is exposed to the client (e.g. an NEXT_PUBLIC_ mirror). */}
          <button type="button" onClick={() => void enterWorkspace()} className={`${BTN} bg-[#d65a4a] text-white`}>
            {t("hero.ctaPrimary")}
            <ArrowRight className="h-5 w-5" aria-hidden />
          </button>
          {/* Public guided demo (B1): a plain navigation to /api/demo mints an
              isolated demo-workspace session and lands on /?sim=auto, which
              auto-plays the JD→Hired run — no login, no key. */}
          <a href="/api/demo" className={`${BTN} bg-white`}>
            {t("hero.ctaDemo")}
            <ArrowRight className="h-5 w-5 text-[#d65a4a]" aria-hidden />
          </a>
          <a href="#voice" className={`${BTN} bg-white`}>
            <Mic className="h-5 w-5 text-[#d65a4a]" aria-hidden />
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
  );
}
