"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Check, Link2 } from "lucide-react";
import { DISPLAY } from "../tokens";
import { ENTER } from "./shared";

/* 05 · Assignment — the live work surface, sealing what it observes.
 *
 * The one thing this step must NOT draw is a verdict on authorship: the product
 * does not decide whether a model wrote the code, and a picture implying it does
 * would be the page's one false frame (docs/features/dev-case/README.md — a
 * missing own watermark is "a mild note, never decisive"). So the art draws the
 * PROCESS being recorded — three session events chained together — and the two
 * checks that do carry ground truth: a planted flaw with a known answer, and the
 * prompt channel captured server-side. */
const EVENTS = ["opened", "asked", "logged"] as const;
const CHIPS = ["flaw", "prompts"] as const;

export default function AssignmentArt({ color = "#42606f" }: { color?: string }) {
  const t = useTranslations("aboutPage");
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-5">
      <motion.div
        initial={{ opacity: 0, y: 18, rotate: -1.5 }}
        whileInView={{ opacity: 1, y: 0, rotate: -1 }}
        viewport={ENTER}
        transition={{ type: "spring", bounce: 0.35 }}
        className="w-full rounded-2xl border-[3px] border-[#17202a] bg-white p-4 shadow-[6px_6px_0_#17202a]"
      >
        <div className="flex items-center justify-between gap-3 border-b-[3px] border-[#17202a] pb-3">
          <span className={`${DISPLAY} text-base font-extrabold`}>{t("art.assignment.surfaceTitle")}</span>
          <span
            className="rounded-full border-2 border-[#17202a] px-2.5 py-0.5 text-xs font-bold text-white"
            style={{ background: color }}
          >
            {t("art.assignment.meta")}
          </span>
        </div>

        <ul className="mt-3 space-y-2.5">
          {EVENTS.map((key, i) => (
            <motion.li
              key={key}
              initial={{ opacity: 0, x: -12 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={ENTER}
              transition={{ delay: 0.2 + i * 0.18, type: "spring", bounce: 0.35 }}
              className="flex items-center gap-2.5"
            >
              <span
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 border-[#17202a]"
                style={{ background: "#dce7d0" }}
              >
                <Link2 className="h-3.5 w-3.5" style={{ color }} aria-hidden />
              </span>
              <span className="text-sm font-semibold text-[#17202a]">{t(`art.assignment.events.${key}`)}</span>
              {/* The hash pill is deliberately a shape, not a value: what the
                  reviewer sees is the VERDICT, never the marker (dev-case
                  README, "Where a reviewer sees them"). */}
              <span aria-hidden className="ml-auto h-1.5 w-12 shrink-0 rounded bg-[#e7dcc8]" />
            </motion.li>
          ))}
        </ul>
      </motion.div>

      <div className="flex flex-wrap justify-center gap-2.5">
        {CHIPS.map((chip, i) => (
          <motion.span
            key={chip}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={ENTER}
            transition={{ delay: 0.65 + i * 0.12, type: "spring", bounce: 0.4 }}
            className="inline-flex items-center gap-1.5 rounded-full border-[3px] border-[#17202a] bg-white px-3 py-1.5 text-sm font-bold shadow-[3px_3px_0_#17202a]"
          >
            <Check className="h-3.5 w-3.5" style={{ color }} aria-hidden />
            {t(`art.assignment.chips.${chip}`)}
          </motion.span>
        ))}
      </div>
    </div>
  );
}
