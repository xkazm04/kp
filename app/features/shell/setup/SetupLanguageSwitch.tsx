"use client";

// The wizard's language control — a four-code strip, not a four-name row.
//
// It used to be a full-width segmented control on the Welcome step ("English ·
// Čeština · Deutsch · Français"), which meant it was gone the moment you pressed
// Continue: a reader who realised on step 3 that they were in the wrong language
// had to go back to find it. It now lives in the left rail, where it stays
// visible for the whole flow, and the endonyms shrink to the locale codes so four
// of them fit a 14.5rem rail. Every button carries its endonym as its accessible
// name — so the "labelled in its own language" property that makes a switcher
// usable to someone who can't read the current UI survives the shrink. (The rail
// prints only the label above the strip; the compact variant below md, which has
// the width for it, still spells out the active language.)
//
// Choosing here switches the app IMMEDIATELY (the reason the control moved to
// step 1 in the first place): setOrgLanguage writes both authorities — the
// NEXT_LOCALE cookie the UI reads and the workspace default that background
// automation and candidate comms read — and router.refresh() re-renders the
// server tree under it, wizard included, since this overlay's client state
// survives a refresh.
//
// Preview mode is the one exception: the ribbon promises nothing persists, so
// there it only moves the local draft and the rest of the app is left alone.
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { META_LABEL, TOGGLE_GROUP, toggleBtn } from "@/app/_components/ui/recipes";
import { setOrgLanguage } from "@/app/_lib/org-actions";
import { APP_LANGUAGES, languageNative, type AppLanguage } from "@/app/features/shared/memberUi";
import type { OnboardingCtrl } from "./setupSteps";

export function SetupLanguageSwitch({ ctrl, compact = false }: { ctrl: OnboardingCtrl; compact?: boolean }) {
  const t = useTranslations("setup.rail");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = ctrl.state.language;

  function choose(language: AppLanguage): void {
    if (language === active) return;
    ctrl.update({ language });
    if (ctrl.mode !== "live") return;
    startTransition(async () => {
      await setOrgLanguage(language);
      router.refresh();
    });
  }

  const strip = (
    <div
      role="group"
      aria-label={t("languageAria")}
      className={`${TOGGLE_GROUP} ${compact ? "" : "grid w-full grid-cols-4"} ${pending ? "opacity-60" : ""}`}
    >
      {APP_LANGUAGES.map((l) => (
        <button
          key={l.value}
          type="button"
          onClick={() => choose(l.value)}
          disabled={pending}
          aria-pressed={l.value === active}
          className={`focus-ring rounded px-1.5 py-1 text-sm font-medium uppercase tracking-wide transition-colors disabled:cursor-wait ${toggleBtn(
            l.value === active
          )}`}
        >
          <span aria-hidden>{l.value}</span>
          {/* The endonym is the accessible name — a screen-reader user hears
              "Čeština", not the letters C S. */}
          <span className="sr-only">{l.native}</span>
        </button>
      ))}
    </div>
  );

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {strip}
        <span className="text-sm text-steel">{languageNative(active)}</span>
      </div>
    );
  }

  return (
    <div>
      <span className={`${META_LABEL} block`}>{t("language")}</span>
      <div className="mt-1">{strip}</div>
    </div>
  );
}
