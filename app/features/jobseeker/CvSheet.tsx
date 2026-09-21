"use client";

import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { Markdown } from "@/app/_components/Markdown";
import { BTN_SECONDARY, DIVIDER, META_LABEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { ArrivalList } from "@/app/features/library/jds/intake/IntakeArrivalMotion";
import { AtelierExemplar } from "@/app/features/library/jds/intake/coats/atelier/atelierPlane";
import type { CvPolishArtifact } from "@/app/_lib/jobseeker/types";
import { useSheetArrival } from "./useSheetArrival";

// The studio's PLANE for a seeker: the polished CV as it stands, the blocks the
// pipeline could not place (shown, never scored), and the grounded suggestions —
// each a before/after pair with the source sentence it rewrites. Apply sends an
// ORDINARY MESSAGE ("Apply suggestion: <section>"), so the engine, the transcript
// and the read-aloud all see the seeker's own words, exactly as a choice card does.
//
// An empty region is an EXEMPLAR, not a skeleton (docs/design/surface-doctrine.md
// §1): six grey bars drew the SHAPE of a CV without saying what a CV holds, which
// leaves a first-time reader with the question the empty state existed to answer.
// `AtelierExemplar` — the intake studio's own empty-brief component, generic over its
// slots — draws the four sections this conversation sets out to fill, each with a
// bracketed slot where its first line lands. (Its right home is the shared Studio
// kit; it is imported rather than copied because a second copy is how the two drift.)
//
// The suggestion and unreadable lists ARRIVE: `useSheetArrival` diffs the rows a turn
// produced and `ArrivalList` staggers only those, so a new suggestion cascades in and
// every row already on the plane keeps its element and stays still.

/** The sections a polished CV sets out with. Labels and slots are catalog copy; the
 *  ANGLE BRACKETS belong to the component (ICU MessageFormat reads `<word>` as a tag,
 *  so a translator who kept them would break the message). */
const EXEMPLAR_SECTIONS = ["summary", "experience", "skills", "education"] as const;

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

  // Identity for the delta: a suggestion IS its section plus the sentence it rewrites
  // (both survive a re-grading); what it currently proposes is the fingerprint, so a
  // rewritten suggestion reads as changed rather than as a new arrival.
  const rows = suggestions.map((s, i) => ({
    ...s,
    key: `${s.section}-${i}`,
    id: `${s.section}\u0000${s.before}`,
    fingerprint: `${s.after}\u0000${s.why}`,
  }));
  const delta = useSheetArrival(rows);

  return (
    <div className="space-y-6 pb-2">
      {markdown ? (
        // A document reads as a column, not as a wall: the plane is as wide as the
        // zone, the prose is not.
        <Markdown content={markdown} className="max-w-prose text-body leading-7 text-ink" />
      ) : (
        <AtelierExemplar
          slots={EXEMPLAR_SECTIONS.map((key) => ({ label: t(`section.${key}`), slot: t(`slot.${key}`) }))}
        />
      )}

      {unreadable.length > 0 ? (
        <section className={`${DIVIDER} pt-4`}>
          <p className={META_LABEL}>{t("unreadableTitle")}</p>
          <p className="mt-1 text-sm text-steel">{t("unreadableBody")}</p>
          <ul className="mt-2 space-y-1.5">
            {unreadable.map((block, i) => (
              <li key={i} className={`${PANEL_SUNKEN} px-2.5 py-1.5 text-sm text-ink`}>
                {block}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={`${DIVIDER} pt-4`}>
        <p className={META_LABEL}>{t("suggestionsTitle")}</p>
        {suggestions.length === 0 ? (
          <p className="mt-1 text-sm text-steel">{t("suggestionsNone")}</p>
        ) : (
          <ul className="mt-3">
            <ArrivalList
              items={rows}
              keyOf={(s) => s.key}
              idOf={(s) => s.id}
              delta={delta}
              itemClassName="space-y-2 pb-4"
              renderItem={(s) => (
                <>
                  <p className="text-sm font-semibold text-ink">{s.section}</p>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
                    <blockquote className={`${PANEL_SUNKEN} px-2.5 py-1.5 text-sm text-steel line-through decoration-stone-400`}>
                      <span className="sr-only">{t("suggestionBefore")} </span>
                      {s.before}
                    </blockquote>
                    <ArrowRight size={14} aria-hidden className="hidden text-steel sm:mt-2 sm:block" />
                    {/* The improved line. Moss is the affirmative accent and there is
                        no moss NOTICE tone, so the tint is explicit — and carries its
                        own dark values, because moss/5 over ink is not a tint, it is
                        nothing. Sticker radius in Spark Dark like every other block. */}
                    <p className="rounded-md border border-moss/40 bg-moss/10 px-2.5 py-1.5 text-sm text-ink dark:rounded-2xl dark:border-moss/60 dark:bg-moss/20">
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
                </>
              )}
            />
          </ul>
        )}
      </section>
    </div>
  );
}
