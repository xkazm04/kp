"use client";

// The Student/Student-case/Regular mode radiogroup, split out of InterviewSimTab.tsx.
// Roving-tabindex keyboard support: arrow keys move + select the next mode.
import { useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";

export type SimMode = "student" | "student-case" | "regular";

export function InterviewModeCards({
  modes,
  mode,
  onPick,
}: {
  modes: { id: SimMode; icon: LucideIcon }[];
  mode: SimMode;
  onPick: (next: SimMode) => void;
}) {
  const t = useTranslations("interviewSim");
  const modeCardRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onModeKeyDown(e: React.KeyboardEvent) {
    const idx = modes.findIndex((m) => m.id === mode);
    let next = idx;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % modes.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + modes.length) % modes.length;
    else return;
    e.preventDefault();
    onPick(modes[next].id);
    modeCardRefs.current[next]?.focus();
  }

  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("modeAria")} onKeyDown={onModeKeyDown}>
      {modes.map((m, i) => {
        const active = m.id === mode;
        const Icon = m.icon;
        // Spark Dark: unpicked mode cards rest a degree off-axis like the
        // landing's feature stickers; choosing (or hovering) one rights it.
        const tilt = active ? "" : i % 2 ? "dark:rotate-1 dark:hover:rotate-0" : "dark:-rotate-1 dark:hover:rotate-0";
        return (
          <button
            key={m.id}
            ref={(el) => {
              modeCardRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onPick(m.id)}
            className={`focus-ring rounded-lg border p-3 text-left transition-all dark:rounded-2xl ${tilt} ${
              active ? "border-coral/40 bg-coral/5 dark:shadow-sticker-sm" : "border-stone-200 bg-paper hover:border-stone-300"
            }`}
          >
            <p className="flex items-center gap-1.5 font-medium text-ink">
              <Icon size={16} className={active ? "text-coral" : "text-steel"} /> {t(`modes.${m.id}.label` as Parameters<typeof t>[0])}
            </p>
            <p className="mt-1 text-sm text-steel">{t(`modes.${m.id}.blurb` as Parameters<typeof t>[0])}</p>
          </button>
        );
      })}
    </div>
  );
}
