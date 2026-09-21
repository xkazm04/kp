"use client";

import { motion } from "framer-motion";
import { Briefcase, Check, FileText, Megaphone, Search, Users, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { CHIP_QUIET, META_LABEL } from "@/app/_components/ui/recipes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { SETUP_PROSE } from "./setupProse";
import { SETUP_INTENTS, type OnboardingCtrl, type SetupIntent } from "./setupSteps";

// Welcome — the one step allowed FULL marketing energy (the landing's stamp/pop
// choreography), expressed through tokens only: this is the hand-off surface
// from the Spark landing into the functional app, so it opens loud and each
// following step gets progressively quieter. All motion is spring-based and
// collapses under reduced motion.
//
// THE FORK COMES FIRST (2026-09-16). Before the pitch, one question: hiring, or
// looking for a job? Two selectable cards (`aria-pressed`, tokens and recipes
// only) write `state.intent`, and everything after this step derives from it —
// `relevantSteps()` drops company/team/pipeline/companion for a seeker, the
// hand-off speaks to them, and finish() lands on /me. Continue stays disabled
// until one is picked (`stepSatisfied("welcome")`), so the fork cannot be walked
// past by accident.
//
// The language picker used to sit here, above the value props, because a reader
// who cannot read the current UI language needs it before they need the pitch.
// That is still true, and it is why the control moved OUT of this step and into
// the wizard's left rail (SetupLanguageSwitch): visible on every step, not only
// this one.
//
// The three value props stay as they are: they pitch the PRODUCT, not the four
// steps of this wizard. They are shown for the hiring intent (and before one is
// picked); a seeker's pitch is the seek card's own blurb.
const VALUE_KEYS = [
  { key: "role", Icon: FileText },
  { key: "channels", Icon: Megaphone },
  { key: "pipeline", Icon: Users },
] as const;

const INTENT_ICON: Record<SetupIntent, LucideIcon> = { hire: Briefcase, seek: Search };

export function WelcomeStep({ ctrl }: { ctrl: OnboardingCtrl }) {
  const t = useTranslations("setup.welcome");
  const tIntent = useTranslations("setup.intent");
  const reduced = useReducedMotion();
  const intent = ctrl.state.intent;

  return (
    <div className={`${SETUP_PROSE} space-y-6`}>
      <div>
        <p className={META_LABEL}>{tIntent("title")}</p>
        <div className="mt-2 grid gap-2.5 sm:grid-cols-2" role="group" aria-label={tIntent("title")}>
          {SETUP_INTENTS.map((option, i) => {
            const Icon = INTENT_ICON[option];
            const on = intent === option;
            return (
              <motion.button
                key={option}
                type="button"
                aria-pressed={on}
                onClick={() => ctrl.update({ intent: option })}
                initial={reduced ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={reduced ? { duration: 0 } : { type: "spring", bounce: 0.3, duration: 0.5, delay: 0.1 + i * 0.1 }}
                className={`focus-ring group flex items-start gap-3 rounded-lg border-2 p-4 text-left transition-all motion-reduce:transition-none ${
                  on
                    ? "border-ink bg-paper shadow-sticker-sm dark:-rotate-1"
                    : "border-stone-300 bg-white hover:-translate-y-0.5 hover:border-ink hover:shadow-sticker-sm motion-reduce:hover:translate-y-0"
                }`}
              >
                <span
                  aria-hidden
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${on ? "bg-coral text-white shadow-sticker-xs" : "bg-steel/10 text-steel group-hover:bg-coral/10 group-hover:text-coral"}`}
                >
                  {on ? <Check size={18} /> : <Icon size={18} />}
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-serif text-xl font-semibold leading-tight text-ink">{tIntent(`${option}.label`)}</span>
                  <span className="mt-0.5 block text-steel">{tIntent(`${option}.blurb`)}</span>
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>

      {intent !== "seek" ? (
        <ul className="space-y-3">
          {VALUE_KEYS.map(({ key, Icon }, i) => (
            <motion.li
              key={key}
              initial={reduced ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduced ? { duration: 0 } : { type: "spring", bounce: 0.35, duration: 0.55, delay: 0.25 + i * 0.12 }}
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
      ) : null}

      <motion.p
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: reduced ? 0 : 0.55, duration: 0.3 }}
      >
        <span className={CHIP_QUIET}>{intent === "seek" ? t("minutesSeek") : t("minutes")}</span>
      </motion.p>
    </div>
  );
}
