"use client";

import { useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { buildUrl } from "@/app/features/shell/tabs";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { DistributionBar, RetiredFlag } from "./CandidateMatrixShared";
import { groupByArchetype, type ArchetypeColumn } from "./candidateMatrixView";
import type { CandidateRow } from "@/app/features/shared/profileTypes";

// VARIANT B — "Ledger": ONE axis, always. Everything is a single vertical column
// ruled into archetype sections, the way a bound register is.
//
// The metaphor: a ledger has no second dimension to get lost in. Archetype becomes
// a sticky SECTION HEADER rather than a column, so the header carrying "which
// archetype am I looking at, how many, what shape" is pinned on screen while you
// scroll its rows — the orientation question answers itself continuously instead of
// requiring a trip back to a header row that has long since scrolled away. The chip
// rail at the top is the ledger's index: every archetype with its count, one click
// to jump, so reaching a distant section never costs a scroll either.
//
// Where this differs from Atlas: Atlas makes you CHOOSE a territory before seeing
// anyone (a map, then a place). The Ledger shows everyone, continuously, and uses
// stickiness + an index to keep you located. Atlas optimizes for "which archetype
// should I work?"; the Ledger optimizes for "let me read down the whole pool".

// One candidate, one line — the density the Atlas's cards deliberately trade away.
function LedgerRow({ cand, onEditProfile }: { cand: CandidateRow; onEditProfile: (id: string) => void }) {
  const t = useTranslations("profile.matrix");
  const tp = useTranslations("scoreProvenance");
  const router = useRouter();
  const isProfile = cand.source === "profile";
  const rowClass =
    "focus-ring group flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-coral/5";
  const body = (
    <>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink group-hover:text-coral">{cand.name}</span>
      <span className="hidden min-w-0 flex-1 truncate text-sm capitalize text-steel sm:block">
        {cand.role ?? "—"}
        {cand.seniority ? ` · ${cand.seniority}` : ""}
      </span>
      <span
        className={`shrink-0 rounded-full px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide ${
          isProfile ? "bg-coral/10 text-coral" : "bg-stone-100 text-steel"
        }`}
      >
        {isProfile ? t("sourceProfile") : t("sourceAnalysis")}
      </span>
      {/* The number on an analysis row is the CV-analysis total, NOT a match score
          — a bare badge would read as a fit score, so it carries the app's
          canonical provenance cue as a title (the card variant shows it inline;
          a one-line row has no room, and the chip beside it already says
          "Analysis"). */}
      <span className="shrink-0" title={!isProfile && cand.score != null ? tp("analysisShort") : undefined}>
        <ScoreBadge score={cand.score} />
      </span>
    </>
  );
  return (
    <li className="flex items-center gap-1 border-b border-stone-100 last:border-0">
      {isProfile ? (
        <button
          type="button"
          onClick={() => cand.id && onEditProfile(cand.id)}
          className={rowClass}
          title={t("openProfileTitle", { name: cand.name })}
        >
          {body}
        </button>
      ) : (
        <>
          <Link href={`/history/${cand.slug}`} className={rowClass} title={t("openAnalysisTitle", { name: cand.name })}>
            {body}
          </Link>
          {/* Promote an analyzed CV into a saved, matchable profile — prefilled and
              STAMPED with source lineage (?fromAnalysis=), so a later re-analysis of
              the same CV surfaces as staleness on the profile. */}
          <button
            type="button"
            onClick={() => cand.slug && router.push(buildUrl({ tab: "archetypes", fromAnalysis: cand.slug }, ""))}
            className="focus-ring shrink-0 rounded-md p-1.5 text-steel hover:bg-stone-100 hover:text-coral"
            title={t("buildFromAnalysisTitle", { name: cand.name })}
          >
            <UserPlus size={14} aria-hidden />
            <span className="sr-only">{t("buildFromAnalysis")}</span>
          </button>
        </>
      )}
    </li>
  );
}

export function CandidateMatrixLedger({
  candidates,
  columns,
  onEditProfile,
}: {
  candidates: CandidateRow[];
  columns: ArchetypeColumn[];
  onEditProfile: (id: string) => void;
}) {
  const t = useTranslations("profile.matrix");
  const enumLabel = useEnumLabel();
  const groups = useMemo(() => groupByArchetype(candidates, columns), [candidates, columns]);
  const sections = useRef<Record<string, HTMLLIElement | null>>({});
  const labelOf = (g: { id: string; label: string }) => (g.label === g.id ? enumLabel("archetype", g.id) : g.label);

  // Scroll, not a hash link: a #anchor would push a history entry and re-home the
  // tab's scroll on Back. `block: "start"` lands the section header exactly where
  // it will stick.
  const jumpTo = (id: string) => sections.current[id]?.scrollIntoView({ block: "start", behavior: "smooth" });

  return (
    <div className="space-y-3">
      {/* THE INDEX — wraps, so it never scrolls sideways either. */}
      <nav aria-label={t("jumpAria")} className="flex flex-wrap gap-1.5">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => jumpTo(g.id)}
            className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-2.5 py-1 text-sm text-steel transition-colors hover:border-coral/40 hover:text-ink"
          >
            {labelOf(g)}
            <span className="nums font-semibold text-ink">{g.candidates.length}</span>
          </button>
        ))}
      </nav>

      {/* THE REGISTER — one column, ruled by archetype. The scroll container is
          bounded so the sticky headers have something to stick INSIDE; without a
          height the page itself scrolls and `sticky` has no effect within the panel. */}
      <ul className="max-h-[34rem] overflow-y-auto rounded-lg border border-stone-200">
        {groups.map((g) => (
          <li key={g.id} ref={(el) => void (sections.current[g.id] = el)}>
            <h3 className="sticky top-0 z-10 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-stone-200 bg-paper px-3 py-2">
              <span className="text-sm font-semibold text-ink">{labelOf(g)}</span>
              <span className="text-meta uppercase text-steel">{t("groupCount", { count: g.candidates.length })}</span>
              {g.archived ? <RetiredFlag /> : null}
              <DistributionBar group={g} className="mt-1 basis-full" />
            </h3>
            <ul className="px-1 py-0.5">
              {g.candidates.map((cand) => (
                <LedgerRow key={cand.key} cand={cand} onEditProfile={onEditProfile} />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
