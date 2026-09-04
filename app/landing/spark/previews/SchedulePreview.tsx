"use client";

import { Check, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { AMBER, MOSS, STEEL } from "../tokens";
import { ConfirmBar, entrance, pop } from "./shared";
import { useStillMotion } from "../useStillMotion";

/* 03 · Self-scheduling — slots deal themselves out. */
export default function SchedulePreview() {
  // next-intl's typed catalog only exposes TOP-LEVEL namespaces, so scope to
  // `landing` and reach this preview's keys by path.
  const t = useTranslations("landing");
  // Reduced motion: the transition, never the markup — see ./shared.tsx.
  const reduce = useStillMotion();
  // Weekday abbreviations differ per language (Mon/Po/Mo/Lun), so they come
  // from the catalog as an array rather than being hardcoded English.
  const days = t.raw("previews.schedule.days") as string[];
  // Clock times are data, not copy — the confirmation sentence that names them
  // is the translated part.
  const slots = ["9:30", "14:00"];

  return (
    <div>
      <p className="text-[17px] font-bold">{t("previews.schedule.title")}</p>
      <p className="text-sm font-bold" style={{ color: STEEL }}>
        {t("previews.schedule.meta")}
      </p>
      <div className="mt-4 grid grid-cols-5 gap-2 text-center text-sm font-bold">
        {days.map((d) => (
          <span key={d} style={{ color: STEEL }}>
            {d}
          </span>
        ))}
        {/* Slots iterate row-major (a whole time band across every day) because
            the grid fills row-major: nesting days outside slots would push
            Wednesday's second slot into Monday's column, under the wrong
            heading — and it is exactly that slot the confirmation names. */}
        {slots.map((time, row) =>
          days.map((d, col) => {
            const picked = col === 2 && row === 1;
            return (
              <motion.span
                key={`${d}-${row}`}
                initial={{ opacity: 0, scale: 0.5, rotate: picked ? -8 : 0 }}
                animate={{ opacity: 1, scale: picked ? 1.08 : 1, rotate: 0 }}
                transition={entrance(reduce, { delay: 0.2 + (row * days.length + col) * 0.06, type: "spring", bounce: 0.45 })}
                className="nums relative rounded-lg border-2 border-[#17202a] px-1 py-2"
                style={picked ? { background: MOSS, color: "#fff" } : { background: "#fff" }}
              >
                {time}
                {picked && (
                  <motion.span {...pop(1.0, reduce)} className="absolute -right-2 -top-2" aria-hidden>
                    <Sparkles className="h-4 w-4" style={{ color: AMBER }} />
                  </motion.span>
                )}
              </motion.span>
            );
          })
        )}
      </div>
      <ConfirmBar background={MOSS} icon={<Check className="h-4 w-4" aria-hidden />}>
        {t("previews.schedule.confirmed")}
      </ConfirmBar>
    </div>
  );
}
