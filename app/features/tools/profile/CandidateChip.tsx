"use client";

// THE COMPACT CANDIDATE CARD — the unit both matrix variants tile.
//
// What it replaced: a card carrying name + score + provenance caption + role +
// seniority + a source pill + a "Build profile" text button. Seven facts and two
// text buttons per person, so ~40 candidates filled a screen and none of it scanned
// — the reader's eye had to parse prose to find a name. Role, role family and the
// provenance caption are not per-candidate reading; they are how you SLICE a
// population, so they moved to the filter bar above the grid and to the detail
// modal behind a click.
//
// What survives on the card is only what you scan BY: the name, the score (colour
// does the ranking before you read the number), the seniority as a single glyph,
// and one icon action. Everything else is one click away.

import { Award, Crown, Pencil, Sprout, TrendingUp, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { CandidateRow } from "@/app/features/shared/profileTypes";

// Seniority as a LADDER of glyphs: a sprout that grows into a trend, an award, a
// crown. The shape carries the level pre-attentively — you read "who is senior
// here" from the icon column without reading a word — and the accessible name plus
// the tooltip still say it in the reader's language, so the glyph is a shortcut,
// never the only channel.
const SENIORITY_ICON: Record<string, typeof Sprout> = {
  junior: Sprout,
  medior: TrendingUp,
  senior: Award,
  lead: Crown,
};

export function SeniorityGlyph({ seniority }: { seniority: string | null }) {
  const enumLabel = useEnumLabel();
  const t = useTranslations("profile.matrix");
  const key = (seniority ?? "").trim().toLowerCase();
  const Icon = SENIORITY_ICON[key];
  // An unknown/absent seniority gets a quiet placeholder rather than a guess — the
  // icon column stays aligned, and "we don't know" is said honestly.
  if (!Icon) {
    return (
      <span className="inline-flex h-4 w-4 items-center justify-center text-stone-300" title={t("seniorityUnknown")}>
        <span className="h-1 w-1 rounded-full bg-current" aria-hidden />
        <span className="sr-only">{t("seniorityUnknown")}</span>
      </span>
    );
  }
  const label = enumLabel("seniority", key);
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center text-steel" title={label}>
      <Icon size={14} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function CandidateChip({
  cand,
  onOpen,
  onSave,
}: {
  cand: CandidateRow;
  /** Open the detail modal — everything the card no longer prints. */
  onOpen: (cand: CandidateRow) => void;
  /** The one-icon primary action: save an analysis as a profile, or edit a saved one. */
  onSave: (cand: CandidateRow) => void;
}) {
  const t = useTranslations("profile.matrix");
  const isProfile = cand.source === "profile";
  // Saved profile → edit it. Analysed CV → promote it into a saved, matchable
  // profile (stamped with source lineage, so a later re-analysis shows as stale).
  const SaveIcon = isProfile ? Pencil : UserPlus;
  const saveLabel = isProfile
    ? t("openProfileTitle", { name: cand.name })
    : t("buildFromAnalysisTitle", { name: cand.name });

  return (
    <div className="group flex items-center gap-1.5 rounded-md border border-stone-200 bg-white pl-2 pr-1 transition-colors hover:border-coral/50 hover:bg-coral/5">
      <SeniorityGlyph seniority={cand.seniority} />
      {/* The name is the click target for detail — the whole point of the card is
          that it is the ONLY prose on it, so it gets the room. */}
      <button
        type="button"
        onClick={() => onOpen(cand)}
        title={t("openDetailTitle", { name: cand.name })}
        className="focus-ring min-w-0 flex-1 truncate py-1.5 text-left text-sm font-semibold text-ink group-hover:text-coral"
      >
        {cand.name}
      </button>
      {/* A saved profile has no score of its own; an analysis row's number is the
          CV-analysis total. The source distinction that used to need a text pill is
          carried by which action icon the card offers. */}
      <ScoreBadge score={cand.score} />
      <button
        type="button"
        onClick={() => onSave(cand)}
        aria-label={saveLabel}
        title={saveLabel}
        className="focus-ring inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-steel transition-colors hover:bg-stone-100 hover:text-coral"
      >
        <SaveIcon size={13} aria-hidden />
      </button>
    </div>
  );
}
