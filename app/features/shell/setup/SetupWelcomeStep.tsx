"use client";

import { useTransition } from "react";
import { motion } from "framer-motion";
import { FileText, Megaphone, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { APP_LANGUAGES, type AppLanguage } from "@/app/features/shared/memberUi";
import { setOrgLanguage } from "@/app/_lib/org-actions";
import { CHIP_QUIET, META_LABEL } from "@/app/_components/ui/recipes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import type { OnboardingCtrl } from "./setupSteps";

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

export function WelcomeStep({ ctrl }: { ctrl: OnboardingCtrl }) {
  const t = useTranslations("setup.welcome");
  const reduced = useReducedMotion();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Language belongs on the FIRST screen, and it has to be real. It used to sit
  // on step 2 as a value that only reached the server at finish(), so a reader
  // who could not read English picked their language and watched the wizard stay
  // in English for three more steps. Choosing here switches the app immediately:
  // setOrgLanguage writes both authorities (the NEXT_LOCALE cookie the UI reads
  // and the workspace default that background automation and candidate comms
  // read), and router.refresh() re-renders the server tree under it — the wizard
  // included, since this overlay's client state survives a refresh.
  //
  // Preview mode is the one exception: the ribbon promises nothing persists, so
  // there it only moves the local draft and the rest of the app is left alone.
  function chooseLanguage(language: AppLanguage): void {
    if (language === ctrl.state.language) return;
    ctrl.update({ language });
    if (ctrl.mode !== "live") return;
    startTransition(async () => {
      await setOrgLanguage(language);
      router.refresh();
    });
  }

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

      {/* Placed above the value props on purpose: a reader who cannot read the
          current UI language needs this before they need the pitch. */}
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? { duration: 0 } : { type: "spring", bounce: 0.3, duration: 0.5, delay: 0.1 }}
      >
        <span className={`${META_LABEL} block`}>{t("languageLabel")}</span>
        <div className={`mt-1 ${pending ? "opacity-60" : ""}`}>
          <SegmentedControl<AppLanguage>
            label={t("languageLabel")}
            value={ctrl.state.language}
            onChange={chooseLanguage}
            options={APP_LANGUAGES.map((l) => ({ value: l.value, label: l.native }))}
          />
        </div>
        <p className="mt-1.5 text-sm text-steel">{t("languageHint")}</p>
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
