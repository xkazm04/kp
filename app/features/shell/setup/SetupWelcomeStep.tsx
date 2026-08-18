"use client";

import { motion } from "framer-motion";
import { FileText, Megaphone, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { CHIP_QUIET } from "@/app/_components/ui/recipes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { SETUP_PROSE } from "./setupProse";

// Welcome — the one step allowed FULL marketing energy (the landing's stamp/pop
// choreography), expressed through tokens only: this is the hand-off surface
// from the Spark landing into the functional app, so it opens loud and each
// following step gets progressively quieter. All motion is spring-based and
// collapses under reduced motion.
//
// The language picker used to sit here, above the value props, because a reader
// who cannot read the current UI language needs it before they need the pitch.
// That is still true, and it is why the control moved OUT of this step and into
// the wizard's left rail (SetupLanguageSwitch): visible on every step, not only
// this one.
//
// The three value props stay as they are: they pitch the PRODUCT, not the four
// steps of this wizard, and "AI drafts the job description" is no less true for
// being done from the Library rather than from here. They ARE the step's content
// now — the brand stamp that used to open it was the third KandidateMark on
// screen (rail, stamp, app chrome), so the props carry the opening energy
// instead: each title steps up to text-2xl (roughly double the old text-sm)
// while its supporting line stays at body size, so the pair still reads as
// heading-then-detail rather than as two headings.
const VALUE_KEYS = [
  { key: "role", Icon: FileText },
  { key: "channels", Icon: Megaphone },
  { key: "pipeline", Icon: Users },
] as const;

export function WelcomeStep() {
  const t = useTranslations("setup.welcome");
  const reduced = useReducedMotion();

  return (
    <div className={`${SETUP_PROSE} space-y-6`}>
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
              <span className="block font-serif text-2xl font-semibold leading-tight text-ink">{t(`values.${key}.title`)}</span>
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
