"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { DISPLAY, HAND, STICKER } from "../tokens";
import type { PreviewKey } from "../previews";
import FeatureCardArt from "./FeatureCardArt";

/*
 * The feature grid — nine sticker cards, each of which opens its live product
 * spotlight on hover, and pins it on click/Enter.
 *
 * Nine cards, three clean rows — and, more to the point, the grid matches the
 * app. `cases` (verified work-sample), `rediscover` and `offer` were all
 * shipped and all missing from the shop window; `cases` sits third rather than
 * last because it is the capability nobody else sells, not an afterthought.
 *
 * A card is title + body over its own watermark (./FeatureCardArt). The
 * leading icon tile and the trailing "peek inside" line both went: the icon
 * reappears three inches away in the spotlight header the card opens, and the
 * hint above the grid already tells you every card peeks — so both spent card
 * space repeating what was a scroll away, while making all nine look alike.
 *
 * The spotlight's open/pinned state lives in the page (SparkLanding) because
 * the modal renders at the page root, so this section takes it as props.
 */
const FEATURES = [
  { rotate: -1.5, preview: "score" },
  { rotate: 1, preview: "voice" },
  { rotate: -1, preview: "cases" },
  { rotate: 1.5, preview: "schedule" },
  { rotate: -1.5, preview: "inbox" },
  { rotate: 1, preview: "salary" },
  { rotate: -1, preview: "rediscover" },
  { rotate: 1.5, preview: "offer" },
  { rotate: -1.5, preview: "gates" }
] as const satisfies ReadonlyArray<{ rotate: number; preview: PreviewKey }>;

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
              className={`${STICKER} group relative cursor-pointer overflow-hidden p-6 text-left focus-ring`}
            >
              <FeatureCardArt preview={f.preview} />
              {/* The art is absolutely positioned, so it would paint over
                  statically-positioned text. One positioned wrapper puts the
                  copy back on top without a z-index on every line. */}
              <div className="relative">
                <h3 className={`${DISPLAY} text-xl font-bold`}>{t(`features.${f.preview}.title`)}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[#42606f]">{t(`features.${f.preview}.body`)}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
