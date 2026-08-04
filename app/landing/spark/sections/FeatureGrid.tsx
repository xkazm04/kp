"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  CalendarCheck,
  Eye,
  FileSearch,
  FileSignature,
  FlaskConical,
  Gauge,
  History,
  Inbox,
  Mic,
  ShieldCheck
} from "lucide-react";
import { DISPLAY, HAND, STICKER } from "../tokens";
import type { PreviewKey } from "../previews";

/*
 * The feature grid — nine sticker cards, each of which opens its live product
 * spotlight on hover, and pins it on click/Enter.
 *
 * Nine cards, three clean rows — and, more to the point, the grid matches the
 * app. `cases` (verified work-sample), `rediscover` and `offer` were all
 * shipped and all missing from the shop window; `cases` sits third rather than
 * last because it is the capability nobody else sells, not an afterthought.
 *
 * The spotlight's open/pinned state lives in the page (SparkLanding) because
 * the modal renders at the page root, so this section takes it as props.
 */
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

export default function FeatureGrid({
  preview,
  pinned,
  onHoverOpen,
  onPin,
  onLeave
}: {
  preview: PreviewKey | null;
  pinned: boolean;
  onHoverOpen: (key: PreviewKey) => void;
  onPin: (key: PreviewKey) => void;
  onLeave: () => void;
}) {
  const t = useTranslations("landing");
  return (
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
          <p className={`${HAND} max-w-xs rotate-1 text-lg text-[#526b4f]`}>{t("features.hint")}</p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.preview}
              role="button"
              tabIndex={0}
              aria-haspopup="dialog"
              aria-expanded={preview === f.preview}
              onHoverStart={() => onHoverOpen(f.preview)}
              onHoverEnd={() => {
                if (!pinned) onLeave();
              }}
              onClick={() => onPin(f.preview)}
              onFocus={() => onHoverOpen(f.preview)}
              onBlur={() => {
                if (!pinned) onLeave();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPin(f.preview);
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
                <f.icon className="h-5 w-5 text-[#d65a4a]" aria-hidden />
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
  );
}
