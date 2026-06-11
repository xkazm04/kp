"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { setTheme } from "@/app/_lib/theme";
import { useTheme } from "@/app/_components/ui/useTheme";

// Compact theme toggle for the studio sidebar, styled to sit beside the
// LanguageSwitcher. Flips data-theme on <html> — the token override seam in
// globals.css (docs/DESIGN.md: Studio Light vs Spark Dark) — and persists the
// explicit choice; the inline script in layout.tsx replays it before first
// paint, defaulting from prefers-color-scheme. The DOM attribute is the source
// of truth, read through useSyncExternalStore: the server snapshot renders the
// default and the real value snaps in at hydration, so there is no
// effect-and-setState cascade and no mismatch.
export function ThemeToggle() {
  const t = useTranslations("theme");
  const theme = useTheme();

  const options = [
    { id: "light", icon: Sun, label: t("light") },
    { id: "dark", icon: Moon, label: t("dark") }
  ] as const;

  return (
    <div role="group" aria-label={t("select")} className="inline-flex items-center gap-0.5 rounded-md border border-stone-200 p-0.5">
      {options.map(({ id, icon: Icon, label }) => {
        const isActive = id === theme;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setTheme(id)}
            aria-pressed={isActive}
            title={label}
            className={`focus-ring rounded p-1.5 transition-colors ${
              isActive ? "bg-ink text-white" : "text-steel hover:bg-stone-100"
            }`}
          >
            <Icon size={14} aria-hidden />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
