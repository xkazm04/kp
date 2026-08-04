"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ArrowRight, Check, Gift, KeyRound, Rocket, Stamp, TrendingUp } from "lucide-react";
import { salesContactHref } from "@/app/_lib/sales-contact";
import { enterWorkspace } from "@/app/_lib/auth/session-nav";
import { track } from "@/app/_lib/analytics/plausible";
import { BTN, DISPLAY, HAND, STICKER } from "./tokens";

/*
 * Spark pricing — four sticker tiers on one loud amber band. Same vocabulary
 * as the rest of the sheet: ink outlines, hard offset shadows, rotated cards.
 * Meters are candidates / cases / interview minutes — never tokens. All copy
 * lives in the `landing.pricing` i18n namespace; these styles carry only the
 * icon, colour and layout for each tier id.
 */
const TIER_STYLES = [
  { id: "free", icon: Gift, color: "#42606f", rotate: -1.5, btnClass: "bg-white" },
  { id: "starter", icon: Rocket, color: "#d65a4a", rotate: 1, btnClass: "bg-[#d65a4a] text-white" },
  { id: "growth", icon: TrendingUp, color: "#526b4f", rotate: -1, btnClass: "bg-[#526b4f] text-white" },
  { id: "byom", icon: KeyRound, color: "#17202a", rotate: 1.5, btnClass: "bg-[#17202a] text-[#fdf8ee]" }
] as const;

export default function PricingSection() {
  const t = useTranslations("landing");
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
            {t.rich("pricing.heading", {
              br: () => <br />,
              emph: (chunks) => <span className="text-[#fdf8ee]">{chunks}</span>
            })}
          </motion.h2>
          <p className={`${HAND} max-w-xs -rotate-1 text-lg leading-snug text-[#17202a]`}>
            {t("pricing.headingNote")}
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {TIER_STYLES.map((tier, i) => {
            const features = t.raw(`pricing.tiers.${tier.id}.features`) as string[];
            const hasBadge = t.has(`pricing.tiers.${tier.id}.badge`);
            return (
              <motion.article
                key={tier.id}
                initial={{ opacity: 0, y: 28 }}
                whileInView={{ opacity: 1, y: 0, rotate: tier.rotate }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ delay: (i % 4) * 0.1, type: "spring", bounce: 0.3 }}
                whileHover={{ rotate: 0, y: -6 }}
                className={`${STICKER} relative flex flex-col p-6`}
              >
                {hasBadge && (
                  <span
                    className={`${HAND} absolute -right-3 -top-4 rotate-3 rounded-full border-[3px] border-[#17202a] bg-[#d65a4a] px-3 py-1 text-sm text-white shadow-[3px_3px_0_#17202a]`}
                  >
                    {t(`pricing.tiers.${tier.id}.badge`)}
                  </span>
                )}

                <span className="inline-grid h-11 w-11 place-items-center rounded-xl border-[3px] border-[#17202a] bg-[#fdf8ee] shadow-[3px_3px_0_#17202a]">
                  <tier.icon className="h-5 w-5" style={{ color: tier.color === "#17202a" ? "#d65a4a" : tier.color }} />
                </span>

                <h3 className={`${DISPLAY} mt-4 text-xl font-bold`}>{t(`pricing.tiers.${tier.id}.name`)}</h3>
                <p className="mt-1 text-[15px] leading-snug text-[#42606f]">{t(`pricing.tiers.${tier.id}.tagline`)}</p>

                <div className="mt-5 flex items-baseline gap-2">
                  <span className={`${DISPLAY} text-4xl font-extrabold`}>{t(`pricing.tiers.${tier.id}.price`)}</span>
                  <span className="text-[15px] font-bold text-[#42606f]">{t(`pricing.tiers.${tier.id}.cadence`)}</span>
                </div>
                <p className={`${HAND} mt-1 text-sm text-[#526b4f]`}>{t(`pricing.tiers.${tier.id}.usd`)}</p>

                <ul className="mt-5 flex-1 space-y-2.5">
                  {features.map((feature) => (
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

                {/* Self-serve tiers enter the product (open mode → dashboard;
                    password mode → the /login form). Enterprise is a sales mailto. */}
                <button
                  type="button"
                  onClick={() => {
                    // Placement + plan attribution for the tier click; the
                    // downstream workspace_entered event carries the plan too.
                    track("landing_cta_click", { placement: "pricing", plan: tier.id });
                    void enterWorkspace(tier.id);
                  }}
                  className={`${BTN} mt-6 w-full justify-center ${tier.btnClass}`}
                >
                  {t(`pricing.tiers.${tier.id}.cta`)}
                  <ArrowRight className="h-5 w-5" />
                </button>
              </motion.article>
            );
          })}
        </div>

        {/* Enterprise / org-scale (UAT M10): a contact-sales tier past the metered
            plans, justified by the SOURCED ROI math an org-scale buyer needs to
            size the spend — the numbers that make the four tiers above worth it. */}
        <div className="mt-10 rounded-2xl border-[3px] border-[#17202a] bg-[#fdf8ee] p-7 shadow-[6px_6px_0_#17202a] md:p-9">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <p className="text-meta font-bold uppercase tracking-[0.12em] text-[#d65a4a]">{t("pricing.enterprise.eyebrow")}</p>
              <h3 className={`${DISPLAY} mt-2 text-3xl font-extrabold`}>{t("pricing.enterprise.heading")}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-[#42606f]">{t("pricing.enterprise.blurb")}</p>
              <ul className="mt-5 grid gap-x-5 gap-y-2 sm:grid-cols-2">
                {(t.raw("pricing.enterprise.capabilities") as string[]).map((cap) => (
                  <li key={cap} className="flex items-start gap-2 text-[14px] font-bold leading-snug text-[#17202a]">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#526b4f]" aria-hidden />
                    {cap}
                  </li>
                ))}
              </ul>
              <a
                href={salesContactHref()}
                onClick={() => track("landing_cta_click", { placement: "pricing", plan: "enterprise" })}
                className={`${BTN} mt-5 bg-[#17202a] text-[#fdf8ee]`}
              >
                {t("pricing.enterprise.cta")}
                <ArrowRight className="h-5 w-5" />
              </a>
            </div>
            <div className="grid shrink-0 grid-cols-3 gap-5 lg:gap-6">
              {[1, 2, 3].map((n) => (
                <div key={n} className="max-w-[8.5rem] text-center">
                  <p className={`${DISPLAY} text-3xl font-extrabold text-[#526b4f]`}>{t(`pricing.enterprise.stat${n}Value`)}</p>
                  <p className="mt-1 text-xs font-bold leading-snug text-[#42606f]">{t(`pricing.enterprise.stat${n}Label`)}</p>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-6 text-[13px] font-semibold leading-relaxed text-[#17202a]">{t("pricing.enterprise.roadmapNote")}</p>
          <p className="mt-2 text-xs leading-relaxed text-[#42606f]">{t("pricing.enterprise.source")}</p>
        </div>

        <div className="mt-10 flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
          <p className={`${HAND} max-w-md -rotate-1 text-lg leading-snug text-[#17202a]`}>
            {t("pricing.footnote1")}
          </p>
          <p className={`${HAND} max-w-sm rotate-1 text-lg leading-snug text-[#17202a]`}>
            {t("pricing.footnote2")}
          </p>
        </div>
      </div>
    </section>
  );
}
