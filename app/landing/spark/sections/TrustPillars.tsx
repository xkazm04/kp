"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { DISPLAY, HAND } from "../tokens";
import { useStillMotion } from "../useStillMotion";
import { TRUST_PILLARS, type TrustKey } from "../trust-art";
import { ArtStage } from "../trust-art/shared";

/*
 * Responsible-AI band (UAT B2): the public compliance story a regulated buyer
 * needs before they'll pilot. Target of the #trust rail entry.
 *
 * It used to be four static cards in a row — an icon, a heading and a
 * paragraph each. Four paragraphs of compliance prose side by side is the
 * least-read furniture on any B2B page, and none of it was evidence: "human in
 * the loop" as a sentence is exactly as believable as a competitor's identical
 * sentence. So the four became four *demonstrations* behind one frame, and the
 * reader picks which claim to have proven to them. The token that waits at the
 * gate and the hash chain that snaps are arguments a paragraph cannot make.
 *
 * Moss ground, because no two bands on this page may share a colour: cream
 * hero → coral marquee → steel proof → limewash features → cream voice → moss
 * trust → amber pricing. This band was cream, directly under the cream voice
 * teaser, so the section boundary did not read as a boundary at all.
 */
export default function TrustPillars() {
  const t = useTranslations("landing");
  const reduceMotion = useStillMotion();
  const [active, setActive] = useState<TrustKey>("human");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = TRUST_PILLARS.findIndex((p) => p.key === active);
  const current = TRUST_PILLARS[index];

  /* Roving-tabindex keyboard nav, the WAI-ARIA tabs pattern: one stop for the
   * whole strip, arrows move between panels and take focus with them. Without
   * it a keyboard reader tabs through four buttons to reach the footnote. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = TRUST_PILLARS.length - 1;
    const next =
      e.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : e.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : -1;
    if (next < 0) return;
    e.preventDefault();
    setActive(TRUST_PILLARS[next].key);
    tabs.current[next]?.focus();
  };

  return (
    <section id="trust" className="border-y-[3px] border-[#17202a] bg-[#526b4f] py-24">
      <div className="mx-auto w-full max-w-6xl px-6">
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          className={`${DISPLAY} text-4xl font-extrabold text-[#fdf8ee] sm:text-5xl`}
        >
          {t.rich("trust.heading", {
            br: () => <br />,
            emph: (chunks) => <span className="text-[#caa54c]">{chunks}</span>
          })}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          className="mt-5 max-w-2xl text-lg leading-relaxed text-[#dce7d0]"
        >
          {t("trust.subtitle")}
        </motion.p>

        {/* The one frame. Its stage is a fixed height (see ArtStage) so
            switching stories never resizes the panel under the cursor. */}
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ type: "spring", bounce: 0.3 }}
          className="mt-12 rounded-3xl border-[3px] border-[#17202a] bg-[#fdf8ee] p-4 shadow-[10px_10px_0_#17202a] sm:p-10"
        >
          <AnimatePresence mode="wait">
            <motion.div
              // Keyed remount → every story replays its choreography on switch.
              key={active}
              id={`trust-panel-${active}`}
              role="tabpanel"
              aria-labelledby={`trust-tab-${active}`}
              tabIndex={0}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -14 }}
              transition={{ duration: 0.22 }}
              className="focus-ring rounded-2xl"
            >
              <ArtStage>
                <current.Art />
              </ArtStage>
              <div className="mx-auto mt-6 min-h-[8.5rem] max-w-2xl text-center">
                <h3 className={`${DISPLAY} text-2xl font-extrabold sm:text-3xl`}>{t(`trust.${active}.title`)}</h3>
                <p className="mt-3 text-lg leading-relaxed text-[#42606f]">{t(`trust.${active}.body`)}</p>
              </div>
            </motion.div>
          </AnimatePresence>
        </motion.div>

        {/* The four options. Sticker buttons on the moss ground: unpressed ones
            keep the band's colour, the pressed one is filled cream — the pill
            slides between them rather than blinking, via a shared layoutId. */}
        <div
          role="tablist"
          aria-label={t("trust.tablist")}
          onKeyDown={onKeyDown}
          className="mt-8 flex flex-wrap justify-center gap-3"
        >
          {TRUST_PILLARS.map((pillar, i) => {
            const on = pillar.key === active;
            return (
              <button
                key={pillar.key}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`trust-tab-${pillar.key}`}
                aria-selected={on}
                aria-controls={`trust-panel-${pillar.key}`}
                tabIndex={on ? 0 : -1}
                onClick={() => setActive(pillar.key)}
                className={`focus-ring relative rounded-2xl border-[3px] border-[#17202a] px-4 py-2.5 text-[15px] font-bold shadow-[4px_4px_0_#17202a] transition-transform ${
                  on ? "text-[#17202a]" : "text-[#fdf8ee] hover:translate-y-[-2px]"
                }`}
              >
                {on && (
                  <motion.span
                    layoutId="trust-tab"
                    className="absolute inset-0 rounded-xl bg-[#fdf8ee]"
                    transition={
                      reduceMotion ? { duration: 0.15 } : { type: "spring", bounce: 0.28, duration: 0.45 }
                    }
                  />
                )}
                <span className="relative flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-[#17202a]"
                    style={{ background: on ? pillar.color : "#fdf8ee" }}
                  />
                  {t(`trust.${pillar.key}.title`)}
                </span>
              </button>
            );
          })}
        </div>

        <p className={`${HAND} mt-8 text-center text-base text-[#dce7d0]`}>{t("trust.footnote")}</p>
      </div>
    </section>
  );
}
