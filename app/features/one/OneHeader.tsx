"use client";

// The shared header of /one, rendered by OneShell in both frames. It carries the
// DECISIONS the home is about: the counts from /api/attention as one segmented group. A
// press asks the same question the chip does (one door, not two) and the stat whose chip is
// the question in view carries the sliding pill (`aria-pressed`). A count the read did not
// return is "—" with its reason, never 0; the most urgent non-zero stat takes the one coral
// figure. A changed count tweens (countTick).
//
// Round 3: ONE quiet control language — the stats are a segmented group (Seg.tsx), the
// Console is a link-styled button, and the brand ("One") is set in the finish's display face
// (`--one-display-font`, finish.css).
//
// Round 5: two frames. On `/one` (frame "page") the header carries the brand mark and the
// Console link; inside the workspace (frame "tab") the workspace IS the console and its
// rail already carries the brand, so the header is the counts row alone — the tab's own head.
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ABSENT, formatCount } from "@/app/_components/kit";
import type { AttentionCounts } from "@/app/_lib/attention";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import { CountTick, SEG_GROUP, Seg } from "./Seg";
import type { OneFrame } from "./panels/PanelShell";
import type { ChipId } from "./types";

/** The header's counts: the attention read's buckets plus (round 4) the outreach letters
 *  waiting for approval, read from the one new door. */
export type HeaderCounts = Partial<AttentionCounts> & { letters?: number };

/** The stats, in urgency order: the first non-zero one takes the accent. Round 4: Letters
 *  (asks the `letters` chip), and Interviews now opens the calendar. */
export const HEADER_STATS = [
  { key: "decisions", chip: "decisions" },
  { key: "pipeline", chip: "stalled" },
  { key: "channels", chip: "arrivals" },
  { key: "letters", chip: "letters" },
  { key: "schedule", chip: "calendar" },
  { key: "jobs", chip: "drafts" },
] as const satisfies readonly { key: keyof HeaderCounts; chip: ChipId }[];

/** The key of the stat to accent: the most urgent one with something waiting. */
export function urgentStat(counts: HeaderCounts | null): (typeof HEADER_STATS)[number]["key"] | null {
  if (!counts) return null;
  const hit = HEADER_STATS.find((s) => (counts[s.key] ?? 0) > 0);
  return hit ? hit.key : null;
}

export function OneHeader({
  counts: attentionCounts,
  letters,
  activeChip,
  onAsk,
  frame,
  consoleHref,
}: {
  counts: Partial<AttentionCounts> | null;
  /** Drafted outreach letters waiting (null = not read: a dash, never 0). */
  letters: number | null;
  /** The chip behind the question in view, if it was a chip. */
  activeChip: ChipId | null;
  onAsk: (chip: ChipId) => void;
  frame: OneFrame;
  consoleHref: string;
}) {
  const t = useTranslations("one.core");
  const locale = useLocale();
  const counts: HeaderCounts | null =
    attentionCounts || letters !== null ? { ...(attentionCounts ?? {}), ...(letters !== null ? { letters } : {}) } : null;
  const urgent = urgentStat(counts);
  const fmt = (n: number) => formatCount(n, locale);
  return (
    <div
      className="flex min-h-16 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-stone-200 bg-paper px-4 py-2 dark:border-b-2"
      data-role="one-header"
    >
      {frame === "page" ? (
        <div className="flex shrink-0 items-center gap-2">
          <KandidateMark className="size-8 shrink-0 text-ink [--k-fg:var(--color-paper)]" />
          <span className="font-[family-name:var(--one-display-font)] text-h2 font-extrabold leading-none tracking-tight text-ink">{t("meta.region")}</span>
        </div>
      ) : null}

      <nav className="flex min-w-0 flex-1 justify-center" aria-label={t("header.label")} data-role="one-stats">
        <div className={`${SEG_GROUP} flex-wrap`}>
          {HEADER_STATS.map((s) => {
            const raw = counts?.[s.key];
            const known = typeof raw === "number" && Number.isFinite(raw);
            const figure = known ? fmt(raw) : ABSENT;
            const accent = urgent === s.key;
            const full = t(`header.stats.${s.key}.full`);
            return (
              <Seg
                key={s.key}
                group="stats"
                active={activeChip === s.chip}
                onClick={(e) => {
                  e.currentTarget.blur(); // the tip is for hover and keyboard; a press must not leave it over the stats
                  onAsk(s.chip);
                }}
                aria-pressed={activeChip === s.chip}
                aria-label={`${figure} ${full}`}
                data-tip={known ? full : t("panels.notReturned")}
                data-stat={s.key}
                data-accent={accent ? "true" : undefined}
              >
                <span className={`k-nums text-body font-semibold ${accent ? "text-coral-ink" : "text-ink"}`}>
                  {known ? <CountTick value={raw} format={fmt} /> : ABSENT}
                </span>
                <span>{t(`header.stats.${s.key}.label`)}</span>
              </Seg>
            );
          })}
        </div>
      </nav>

      {frame === "page" ? (
        <div className="flex shrink-0 items-center gap-3">
          <Link className="k-btn k-btn--link k-btn--sm" href={consoleHref} data-tip={t("meta.consoleTip")} data-role="one-console">
            {t("meta.console")} <span aria-hidden>→</span>
          </Link>
        </div>
      ) : null}
    </div>
  );
}
