"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { BTN, DISPLAY, HAND } from "../tokens";
import { enterWorkspace } from "@/app/_lib/auth/session-nav";
import { track } from "@/app/_lib/analytics/plausible";

/* Closing call to action. */
export default function Cta() {
  const t = useTranslations("landing");
  return (
    <section id="cta" className="mx-auto w-full max-w-7xl px-6 py-24">
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
        <p className="relative mx-auto mt-4 max-w-md text-lg text-[#fdf8ee]/90">{t("cta.body")}</p>
        <motion.button
          type="button"
          onClick={() => {
            track("landing_cta_click", { placement: "closing" });
            void enterWorkspace();
          }}
          whileHover={{ scale: 1.04, rotate: -1 }}
          whileTap={{ scale: 0.97 }}
          className={`${BTN} relative mt-8 bg-[#fdf8ee]`}
        >
          {t("cta.button")}
          <ArrowRight className="h-5 w-5 text-[#d65a4a]" aria-hidden />
        </motion.button>
        <p className={`${HAND} relative mt-5 text-base text-[#fdf8ee]/80`}>{t("cta.note")}</p>
      </motion.div>
    </section>
  );
}
