"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/app/_components/Checkbox";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { DIVIDER, EYEBROW, META_LABEL, PANEL, railIconBtn } from "@/app/_components/ui/recipes";
import type { CompanionPrefsState } from "./useCompanionPrefs";
import type { CompanionUiMode } from "./companionPrefs";

/*
 * Candi's settings — the gear in her own chrome, in BOTH shapes she wears.
 *
 * Round V2 needs exactly two controls, and the temptation is a two-line popup
 * with two toggles in it. This is deliberately not that. The companion has a
 * whole owed policy surface behind it (which model she may reach for, what she
 * is allowed to remember, whether a proposal may execute without a second
 * confirmation), and every one of those is a titled GROUP of related choices
 * with a sentence explaining what the choice costs. So the panel is built as
 * that panel, holding two groups today: a heading, an intro that says where the
 * settings live (this browser, not the workspace — an operator is entitled to
 * know a teammate will not see this), and `SettingsGroup` rows that a third and
 * fourth group drop into without touching anything here.
 *
 * WHY A POPOVER AND NOT A ROUTE. These are two preferences about the window you
 * are looking at, changed while looking at it — the choice and its effect must
 * be on screen together, which a settings tab three clicks away cannot do. The
 * moment a group arrives whose effect is NOT visible from here (model routing,
 * memory scope) that group belongs in Setup, and this panel should link to it
 * rather than grow it.
 *
 * The dismissal contract is `NavRailPreferences`' verbatim, because it is the
 * one already in the shell: pointerdown outside the wrapper closes, Escape
 * closes and returns focus to the trigger, and both listeners are bound only
 * while open so a closed menu costs nothing.
 */

export function CompanionSettingsMenu({
  prefs,
  open,
  onOpenChange,
  /** Where the panel hangs off the trigger. The dock's gear sits at the right
   *  end of a 30rem header (`end`); voice mode's sits in a full-width rail. */
  align = "end",
  /** Which way the panel grows. The voice header is at the TOP of the screen,
   *  so its panel must open downward; the dock's toolbar has room either way. */
  side = "bottom",
}: {
  prefs: CompanionPrefsState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  align?: "start" | "end";
  side?: "bottom" | "top";
}) {
  const t = useTranslations("companion");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Stopped here so Escape closes the PANEL and not the window behind it —
      // two dismissals from one key is the shape nobody can undo.
      event.stopPropagation();
      onOpenChange(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  const modeOptions: ReadonlyArray<{ value: CompanionUiMode; label: string }> = [
    { value: "dock", label: t("settings.modeDock") },
    { value: "voice", label: t("settings.modeVoice") },
  ];

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("settings.open")}
        title={t("settings.open")}
        onClick={() => onOpenChange(!open)}
        className={railIconBtn(open)}
      >
        <Settings2 size={18} aria-hidden />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-labelledby={titleId}
          className={`${PANEL} absolute z-50 w-[19rem] max-w-[calc(100vw-1.5rem)] p-3.5 ${
            side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5"
          } ${align === "end" ? "right-0" : "left-0"}`}
        >
          <p className={EYEBROW}>{t("settings.eyebrow")}</p>
          <h3 id={titleId} className="mt-0.5 font-serif text-h3 text-ink">
            {t("settings.title")}
          </h3>
          <p className="mt-1 text-sm text-steel">{t("settings.intro")}</p>

          <SettingsGroup title={t("settings.interface")} hint={t("settings.interfaceHint")}>
            <SegmentedControl
              label={t("settings.modeLabel")}
              options={modeOptions}
              value={prefs.mode}
              onChange={prefs.setMode}
            />
          </SettingsGroup>

          <SettingsGroup title={t("settings.speech")} hint={null}>
            <Checkbox
              checked={prefs.autoSpeak}
              onChange={(event) => prefs.setAutoSpeak(event.target.checked)}
              label={t("settings.autoSpeak")}
              // The honest caveat, said in the control rather than discovered as
              // silence: the browser will refuse the first unasked-for utterance
              // and the surface will offer a play button instead.
              hint={t("settings.autoSpeakHint")}
            />
          </SettingsGroup>
        </div>
      ) : null}
    </div>
  );
}

/** One titled group of related choices. The unit this panel is made of, so the
 *  third group is an insertion rather than a redesign. */
function SettingsGroup({ title, hint, children }: { title: string; hint: string | null; children: ReactNode }) {
  return (
    <section className={`${DIVIDER} mt-3.5 pt-3`}>
      <h4 className={META_LABEL}>{title}</h4>
      {hint ? <p className="mb-2 mt-1 text-sm text-steel">{hint}</p> : <div className="mt-2" />}
      {children}
    </section>
  );
}
