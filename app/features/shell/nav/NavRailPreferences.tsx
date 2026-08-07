"use client";

/*
 * First-level (rail) workspace preferences: appearance and language.
 *
 * These used to sit in the level-2 panel footer as two always-expanded segmented
 * toggles — four buttons of chrome under every nav list, and the language one was
 * missing entirely on the deep-link (link-mode) sidebar. On the rail each one
 * collapses to just its ACTIVE variant (the current theme's glyph, the current
 * locale's code); clicking opens a popup with the variants to switch to. Same
 * plumbing as `LanguageSwitcher`, which still serves the public apply/status
 * pages: setTheme flips data-theme on <html>, setLocale writes the NEXT_LOCALE
 * cookie and the router refresh re-renders the server tree. This is now the ONLY
 * theme switcher in the app — the old `ThemeToggle` it replaced was deleted once
 * it was found to have no importers (the public pages carry a language switcher
 * but never carried a theme one).
 *
 * One component owns both menus so opening one closes the other, and so the
 * outside-click/Escape dismissal is written once. The popup opens to the RIGHT of
 * the rail (left-full) and grows UPWARD from the bottom (bottom-0) — it stays
 * inside the sidebar's own width, which matters because the <aside> that hosts
 * the rail clips overflow.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Moon, Sun, type LucideIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { setLocale } from "@/i18n/actions";
import { LOCALES, type Locale } from "@/i18n/locales";
import { setTheme, type Theme } from "@/app/_lib/theme";
import { useTheme } from "@/app/_components/ui/useTheme";
import { PANEL, railIconBtn } from "@/app/_components/ui/recipes";
import { navItemClass } from "@/app/features/shell/tabs";

type MenuId = "theme" | "language";

type MenuOption = {
  id: string;
  label: string;
  /** Shown in the menu row and, for the active option, on the rail trigger. */
  icon?: LucideIcon;
  /** Text stand-in for a glyph (the locale code) when there is no icon. */
  glyph?: string;
};

function RailMenu({
  open,
  onOpenChange,
  menuLabel,
  options,
  activeId,
  onPick,
  pending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name for both the trigger and the popup ("Select theme"…). */
  menuLabel: string;
  options: MenuOption[];
  activeId: string;
  onPick: (id: string) => void;
  pending?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const activeOption = options.find((o) => o.id === activeId) ?? options[0];
  const ActiveIcon = activeOption?.icon;

  // Dismissal: a pointerdown outside the wrapper, or Escape from anywhere in it.
  // Bound only while open, so the closed state costs nothing.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
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

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={menuLabel}
        title={activeOption ? `${menuLabel}: ${activeOption.label}` : menuLabel}
        onClick={() => onOpenChange(!open)}
        className={railIconBtn(open)}
      >
        {ActiveIcon ? (
          <ActiveIcon size={18} aria-hidden />
        ) : (
          <span className="text-[13px] font-semibold uppercase tracking-wide" aria-hidden>
            {activeOption?.glyph}
          </span>
        )}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={menuLabel}
          className={`${PANEL} absolute bottom-0 left-full z-50 ml-1.5 min-w-[9.5rem] p-1`}
        >
          {options.map((option) => {
            const Icon = option.icon;
            const isActive = option.id === activeId;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                disabled={pending}
                onClick={() => {
                  onOpenChange(false);
                  if (!isActive) onPick(option.id);
                }}
                className={`focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium transition-colors disabled:opacity-60 ${navItemClass(isActive)}`}
              >
                {Icon ? (
                  <Icon size={15} aria-hidden className="shrink-0" />
                ) : (
                  <span className="w-[1.6ch] shrink-0 text-center font-semibold uppercase" aria-hidden>
                    {option.glyph}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {isActive ? <Check size={14} aria-hidden className="shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function RailPreferences() {
  const themeText = useTranslations("theme");
  const languageText = useTranslations("language");
  const theme = useTheme();
  const activeLocale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // One open-menu id, so opening the second closes the first.
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const toggle = (menu: MenuId) => (next: boolean) => setOpenMenu(next ? menu : null);

  const themeOptions: MenuOption[] = [
    { id: "light", label: themeText("light"), icon: Sun },
    { id: "dark", label: themeText("dark"), icon: Moon },
  ];
  // Each locale is named in its OWN language ("English" / "Čeština") — the
  // conventional switcher affordance, so a reader who can't read the current UI
  // language still finds theirs. The trigger's glyph is the bare locale code.
  const localeOptions: MenuOption[] = LOCALES.map((locale) => ({
    id: locale,
    label: languageText(locale),
    glyph: locale,
  }));

  return (
    <>
      <RailMenu
        open={openMenu === "theme"}
        onOpenChange={toggle("theme")}
        menuLabel={themeText("select")}
        options={themeOptions}
        activeId={theme}
        onPick={(id) => setTheme(id as Theme)}
      />
      <RailMenu
        open={openMenu === "language"}
        onOpenChange={toggle("language")}
        menuLabel={languageText("select")}
        options={localeOptions}
        activeId={activeLocale}
        pending={pending}
        onPick={(id) =>
          startTransition(async () => {
            await setLocale(id as Locale);
            router.refresh();
          })
        }
      />
    </>
  );
}
