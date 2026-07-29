"use client";

import { motion } from "framer-motion";
import { FileText, Megaphone, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import { CHIP_QUIET } from "@/app/_components/ui/recipes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";

// Welcome — the one step allowed FULL marketing energy (the landing's stamp/pop
// choreography), expressed through tokens only: this is the hand-off surface
// from the Spark landing into the functional app, so it opens loud and each
// following step gets progressively quieter. All motion is spring-based and
// collapses under reduced motion.
const VALUE_KEYS = [
  { key: "role", Icon: FileText },
  { key: "channels", Icon: Megaphone },
  { key: "pipeline", Icon: Users },
] as const;

export function WelcomeStep() {
  const t = useTranslations("setup.welcome");
  const reduced = useReducedMotion();

  return (
    <div className="max-w-lg space-y-6">
      {/* Brand stamp — lands like a sticker being pressed onto the page. */}
      <motion.div
        initial={reduced ? false : { scale: 2.2, opacity: 0, rotate: 8 }}
        animate={{ scale: 1, opacity: 1, rotate: -3 }}
        transition={reduced ? { duration: 0 } : { type: "spring", bounce: 0.45, duration: 0.7 }}
        className="grid h-16 w-16 place-items-center rounded-2xl border-2 border-ink bg-paper shadow-pop"
      >
        <KandidateMark className="h-9 w-9 text-ink [--k-accent:var(--color-coral)] [--k-fg:var(--color-paper)]" />
      </motion.div>

      <ul className="space-y-3">
        {VALUE_KEYS.map(({ key, Icon }, i) => (
          <motion.li
            key={key}
            initial={reduced ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduced ? { duration: 0 } : { type: "spring", bounce: 0.35, duration: 0.55, delay: 0.15 + i * 0.12 }}
            className="flex items-start gap-3"
          >
            <span
              aria-hidden
              className="inline-grid h-10 w-10 shrink-0 place-items-center rounded-xl border-2 border-ink bg-white text-ink shadow-sticker-xs dark:-rotate-2"
            >
              <Icon size={18} />
            </span>
            <span className="min-w-0 text-sm">
              <span className="block font-semibold text-ink">{t(`values.${key}.title`)}</span>
              <span className="text-steel">{t(`values.${key}.body`)}</span>
            </span>
          </motion.li>
        ))}
      </ul>

      <motion.p
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: reduced ? 0 : 0.55, duration: 0.3 }}
      >
        <span className={CHIP_QUIET}>{t("minutes")}</span>
      </motion.p>
    </div>
  );
}
