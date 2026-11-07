"use client";

// The shared header of /one, rendered by OneShell for every layout. It carries the DECISIONS
// the home is about: the counts from /api/attention as clickable stats. A press asks the same
// question the chip does (so it is one door, not two) and marks the stat as the current
// question. A count the read did not return is "—" with its reason, never 0; the most urgent
// non-zero stat takes the one coral accent. Compact = inline stats; hero = big tiles with the
// figure in display type (the layout chooses via HEADER_SIZE in variants/index.ts).
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ABSENT, formatCount } from "@/app/_components/kit";
import { STAT, STAT_LABEL } from "@/app/_components/ui/recipes";
import type { AttentionCounts } from "@/app/_lib/attention";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import { Switcher } from "./Switcher";
import type { ChipId, VariantId } from "./types";

export type HeaderSize = "compact" | "hero";

/** The stats, in urgency order: the first non-zero one takes the accent. */
export const HEADER_STATS = [
  { key: "decisions", chip: "decisions" },
  { key: "pipeline", chip: "stalled" },
  { key: "channels", chip: "arrivals" },
  { key: "schedule", chip: "interviews" },
  { key: "jobs", chip: "drafts" },
] as const satisfies readonly { key: keyof AttentionCounts; chip: ChipId }[];

/** The key of the stat to accent: the most urgent one with something waiting. */
export function urgentStat(counts: Partial<AttentionCounts> | null): (typeof HEADER_STATS)[number]["key"] | null {
  if (!counts) return null;
  const hit = HEADER_STATS.find((s) => (counts[s.key] ?? 0) > 0);
  return hit ? hit.key : null;
}

export function OneHeader({
  size,
  counts,
  activeChip,
  onAsk,
  variant,
  showSwitcher,
  consoleHref,
}: {
  size: HeaderSize;
  counts: Partial<AttentionCounts> | null;
  /** The chip behind the question in view, if it was a chip. */
  activeChip: ChipId | null;
  onAsk: (chip: ChipId) => void;
  variant: VariantId;
  showSwitcher: boolean;
  consoleHref: string;
}) {
  const t = useTranslations("one.core");
  const locale = useLocale();
  const urgent = urgentStat(counts);
  const hero = size === "hero";
  return (
    <div
      className={`flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-stone-200 bg-paper px-4 dark:border-b-2 ${hero ? "min-h-28 py-3" : "min-h-16 py-2"}`}
      data-role="one-header"
      data-size={size}
    >
      <div className="flex shrink-0 items-center gap-2">
        <KandidateMark className="size-8 shrink-0 text-ink [--k-fg:var(--color-paper)]" />
        <span className="font-serif text-h3 text-ink">{t("meta.region")}</span>
      </div>

      <nav className={`flex min-w-0 flex-1 flex-wrap items-center gap-1 ${hero ? "justify-center gap-3" : "justify-center"}`} aria-label={t("header.label")} data-role="one-stats">
        {HEADER_STATS.map((s) => {
          const raw = counts?.[s.key];
          const known = typeof raw === "number" && Number.isFinite(raw);
          const figure = known ? formatCount(raw, locale) : ABSENT;
          const accent = urgent === s.key;
          const active = activeChip === s.chip;
          const figureCls = accent ? "text-coral-ink" : "text-ink";
          const full = t(`header.stats.${s.key}.full`);
          const tip = known ? full : t("panels.notReturned");
          return (
            <button
              key={s.key}
              type="button"
              onClick={(e) => {
                e.currentTarget.blur(); // the tip is for hover and keyboard; a press must not leave it over the stats
                onAsk(s.chip);
              }}
              aria-pressed={active}
              aria-label={`${figure} ${full}`}
              data-tip={tip}
              data-stat={s.key}
              data-accent={accent ? "true" : undefined}
              className={
                hero
                  ? `${STAT} focus-ring min-w-32 cursor-pointer items-start px-4 py-2 text-left transition-colors hover:bg-stone-50 ${active ? "border-ink" : ""}`
                  : `focus-ring flex h-10 cursor-pointer items-baseline gap-1.5 rounded-md px-3 py-2 transition-colors hover:bg-stone-100 dark:rounded-lg ${active ? "bg-stone-100 shadow-[inset_0_-2px_0_var(--color-ink)]" : ""}`
              }
            >
              {hero ? (
                <>
                  <span className={`k-nums font-serif text-display leading-none ${figureCls}`}>{figure}</span>
                  <span className={STAT_LABEL}>{t(`header.stats.${s.key}.label`)}</span>
                </>
              ) : (
                <>
                  <span className={`k-nums text-body font-semibold ${figureCls}`}>{figure}</span>
                  <span className="text-micro text-steel">{t(`header.stats.${s.key}.label`)}</span>
                </>
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex shrink-0 items-center gap-3">
        {showSwitcher ? <Switcher current={variant} /> : null}
        <Link className="k-btn k-btn--secondary k-btn--sm" href={consoleHref} data-tip={t("meta.consoleTip")} data-role="one-console">
          {t("meta.console")}
        </Link>
      </div>
    </div>
  );
}
