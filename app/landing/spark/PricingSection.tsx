"use client";

import { motion } from "framer-motion";
import { ArrowRight, Gift, KeyRound, Rocket, Stamp, TrendingUp } from "lucide-react";
import { BTN, DISPLAY, HAND, STICKER } from "./tokens";

/*
 * Spark pricing — four sticker tiers on one loud amber band. Same vocabulary
 * as the rest of the sheet: ink outlines, hard offset shadows, rotated cards.
 * Meters are candidates / cases / interview minutes — never tokens.
 */
const TIERS: ReadonlyArray<{
  name: string;
  icon: typeof Gift;
  tagline: string;
  price: string;
  cadence: string;
  usd: string;
  color: string;
  rotate: number;
  cta: string;
  btnClass: string;
  badge?: string;
  features: readonly string[];
}> = [
  {
    name: "Free",
    icon: Gift,
    tagline: "Kick the tires on a real opening.",
    price: "0 Kč",
    cadence: "forever",
    usd: "no card, no clock",
    color: "#42606f",
    rotate: -1.5,
    cta: "Start free",
    btnClass: "bg-white",
    features: [
      "1 active job",
      "5 AI candidates a month",
      "1 dev case design",
      "Unlimited matching, pipeline & scheduling"
    ]
  },
  {
    name: "Starter",
    icon: Rocket,
    tagline: "A hiring desk that never sleeps.",
    price: "490 Kč",
    cadence: "/ month",
    usd: "≈ $21 a month",
    color: "#d65a4a",
    rotate: 1,
    cta: "Pick Starter",
    btnClass: "bg-[#d65a4a] text-white",
    features: [
      "100 AI candidates a month",
      "5 dev case designs",
      "30 AI interview minutes",
      "Unlimited jobs & campaign packs"
    ]
  },
  {
    name: "Growth",
    icon: TrendingUp,
    tagline: "For pipelines with traffic.",
    price: "1 190 Kč",
    cadence: "/ month",
    usd: "≈ $50 a month",
    color: "#526b4f",
    rotate: -1,
    cta: "Pick Growth",
    btnClass: "bg-[#526b4f] text-white",
    features: [
      "400 AI candidates a month",
      "20 dev case designs",
      "120 AI interview minutes",
      "Everything in Starter, just bigger"
    ]
  },
  {
    name: "BYOM",
    icon: KeyRound,
    tagline: "Your model keys, our machinery.",
    price: "120 Kč",
    cadence: "/ month",
    usd: "≈ $5 a month",
    color: "#17202a",
    rotate: 1.5,
    cta: "Bring your keys",
    btnClass: "bg-[#17202a] text-[#fdf8ee]",
    badge: "bring your keys",
    features: [
      "Plug in Gemini, OpenAI, Azure or Anthropic keys",
      "Your ElevenLabs key runs the interviews",
      "Unlimited AI — your providers bill you",
      "We charge for the machinery only"
    ]
  }
];

export default function PricingSection() {
  return (
    <section id="pricing" className="border-y-[3px] border-[#17202a] bg-[#caa54c] py-24">
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <motion.h2
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            className={`${DISPLAY} text-4xl font-extrabold sm:text-5xl`}
          >
            Tiny prices.
            <br />
            <span className="text-[#fdf8ee]">Zero token math.</span>
          </motion.h2>
          <p className={`${HAND} max-w-xs -rotate-1 text-lg leading-snug text-[#17202a]`}>
            free while we’re in early access — these are the launch prices you’ll lock in
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {TIERS.map((tier, i) => (
            <motion.article
              key={tier.name}
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0, rotate: tier.rotate }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: (i % 4) * 0.1, type: "spring", bounce: 0.3 }}
              whileHover={{ rotate: 0, y: -6 }}
              className={`${STICKER} relative flex flex-col p-6`}
            >
              {tier.badge && (
                <span
                  className={`${HAND} absolute -right-3 -top-4 rotate-3 rounded-full border-[3px] border-[#17202a] bg-[#d65a4a] px-3 py-1 text-sm text-white shadow-[3px_3px_0_#17202a]`}
                >
                  {tier.badge}
                </span>
              )}

              <span className="inline-grid h-11 w-11 place-items-center rounded-xl border-[3px] border-[#17202a] bg-[#fdf8ee] shadow-[3px_3px_0_#17202a]">
                <tier.icon className="h-5 w-5" style={{ color: tier.color === "#17202a" ? "#d65a4a" : tier.color }} />
              </span>

              <h3 className={`${DISPLAY} mt-4 text-xl font-bold`}>{tier.name}</h3>
              <p className="mt-1 text-[15px] leading-snug text-[#42606f]">{tier.tagline}</p>

              <div className="mt-5 flex items-baseline gap-2">
                <span className={`${DISPLAY} text-4xl font-extrabold`}>{tier.price}</span>
                <span className="text-[15px] font-bold text-[#42606f]">{tier.cadence}</span>
              </div>
              <p className={`${HAND} mt-1 text-sm text-[#526b4f]`}>{tier.usd}</p>

              <ul className="mt-5 flex-1 space-y-2.5">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-[15px] font-bold leading-snug">
                    <span
                      className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-[3px] border-[#17202a] shadow-[2px_2px_0_#17202a]"
                      style={{ background: tier.color }}
                    >
                      <Stamp className="h-3 w-3 text-white" />
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>

              <a href="#cta" className={`${BTN} mt-6 w-full justify-center ${tier.btnClass}`}>
                {tier.cta}
                <ArrowRight className="h-5 w-5" />
              </a>
            </motion.article>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
          <p className={`${HAND} max-w-md -rotate-1 text-lg leading-snug text-[#17202a]`}>
            “AI candidate” = one person fully worked — CV scored, matched, reasoned about, outreach drafted
          </p>
          <p className={`${HAND} max-w-sm rotate-1 text-lg leading-snug text-[#17202a]`}>
            out of minutes? 100-minute interview packs · 790&nbsp;Kč — any tier, even BYOM
          </p>
        </div>
      </div>
    </section>
  );
}
