"use client";

import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { Markdown } from "@/app/_components/Markdown";
import { Skeleton } from "@/app/_components/Skeleton";
import { BTN_SECONDARY, META_LABEL } from "@/app/_components/ui/recipes";
import type { CvPolishArtifact } from "@/app/_lib/jobseeker/types";

// The studio's PLANE for a seeker: the polished CV as it stands, the blocks the
// pipeline could not place (shown, never scored), and the grounded suggestions —
// each a before/after pair with the source sentence it rewrites. Apply sends an
// ORDINARY MESSAGE ("Apply suggestion: <section>"), so the engine, the transcript
// and the read-aloud all see the seeker's own words, exactly as a choice card does.
//
// An empty region shows the SHAPE of what will fill it (skeleton lines), not a
// sentence promising that it will (studioZones.ts doctrine).

export function CvSheet({
  artifact,
  fallbackMarkdown,
  closed,
  sending,
  onApply,
}: {
  artifact: CvPolishArtifact | null;
  /** The profile's stored polished CV, for a dialog whose artifact is not (yet) on the wire. */
  fallbackMarkdown: string | null;
  closed: boolean;
  sending: boolean;
  onApply(section: string): void;
}) {
  const t = useTranslations("me.cv");
  const markdown = artifact?.cvMarkdown ?? fallbackMarkdown;
  const suggestions = artifact?.suggestions ?? [];
  const unreadable = artifact?.unreadable ?? [];

  return (
    <div className="space-y-6 pb-2">
      {markdown ? (
        <Markdown content={markdown} className="text-body leading-7 text-ink" />
      ) : (
        <div className="space-y-2" aria-label={t("sheetEmpty")} role="img">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="mt-4 h-4 w-1/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      )}

      {unreadable.length > 0 ? (
        <section className="border-t border-stone-200 pt-4">
          <p className={META_LABEL}>{t("unreadableTitle")}</p>
          <p className="mt-1 text-sm text-steel">{t("unreadableBody")}</p>
          <ul className="mt-2 space-y-1.5">
            {unreadable.map((block, i) => (
              <li key={i} className="rounded-md bg-stone-50 px-2.5 py-1.5 text-sm text-ink">
                {block}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="border-t border-stone-200 pt-4">
        <p className={META_LABEL}>{t("suggestionsTitle")}</p>
        {suggestions.length === 0 ? (
          <p className="mt-1 text-sm text-steel">{t("suggestionsNone")}</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {suggestions.map((s, i) => (
              <li key={`${s.section}-${i}`} className="space-y-2">
                <p className="text-sm font-semibold text-ink">{s.section}</p>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
                  <blockquote className="rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-sm text-steel line-through decoration-stone-400">
                    <span className="sr-only">{t("suggestionBefore")} </span>
                    {s.before}
                  </blockquote>
                  <ArrowRight size={14} aria-hidden className="hidden text-steel sm:mt-2 sm:block" />
                  <p className="rounded-md border border-moss/30 bg-moss/5 px-2.5 py-1.5 text-sm text-ink">
                    <span className="sr-only">{t("suggestionAfter")} </span>
                    {s.after}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-meta text-steel">{s.why}</p>
                  {!closed ? (
                    <button type="button" className={`${BTN_SECONDARY} h-8 px-3 text-sm`} disabled={sending} onClick={() => onApply(s.section)}>
                      {t("apply")}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
