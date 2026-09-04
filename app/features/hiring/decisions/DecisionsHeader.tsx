"use client";

// The Decisions tab header: eyebrow/title/intro, the role/governance-mode
// filters, the pending count, the reconsider chip and the rules button. Split
// out of DecisionsTab to keep that file's render shell under the 200-line cap.
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { Select } from "@/app/_components/Select";
import { roleKeyOf } from "./decisionsQueueTypes";
import type { Entry } from "@/app/features/shared/decisionsTypes";

export function DecisionsHeader({
  jobOptions,
  activeFilter,
  pending,
  setJobFilter,
  evalMode,
  setEvalMode,
  reconsiderCount,
  onRevealReconsider,
  onOpenRules,
  pendingHeaderCount,
}: {
  jobOptions: { key: string; label: string }[];
  activeFilter: string | null;
  pending: Entry[];
  setJobFilter: (v: string | null) => void;
  evalMode: "recommendation" | "committee" | "eligibility_list";
  setEvalMode: (v: "recommendation" | "committee" | "eligibility_list") => void;
  reconsiderCount: number;
  onRevealReconsider: () => void;
  onOpenRules: () => void;
  // Precomputed by the caller: activeFilter's visible-cards count, or pending.length.
  pendingHeaderCount: number;
}) {
  const t = useTranslations("decisions");

  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h2 className="mt-1 font-serif text-display text-ink">{t("title")}</h2>
        {/* One line. The paragraph used to explain the click target, the group-eval
            button and where interview slots live — three affordances that are all
            on screen, so the prose was a caption for controls the reader can see. */}
        <p className="mt-1 max-w-2xl text-body text-steel">{t("intro")}</p>
      </div>
      <div className="flex items-center gap-2">
        {jobOptions.length > 1 ? (
          <Select
            ariaLabel={t("filterTitle")}
            value={activeFilter ?? ""}
            onChange={(v) => setJobFilter(v || null)}
            size="sm"
            options={[
              { value: "", label: t("allRoles", { count: pending.length }) },
              ...jobOptions.map((o) => ({ value: o.key, label: `${o.label} (${pending.filter((e) => roleKeyOf(e) === o.key).length})` })),
            ]}
          />
        ) : null}
        <Select
          ariaLabel={t("govModeTitle")}
          value={evalMode}
          onChange={(v) => setEvalMode(v as typeof evalMode)}
          size="sm"
          options={[
            { value: "recommendation", label: t("govRecommendation") },
            { value: "committee", label: t("govCommittee") },
            { value: "eligibility_list", label: t("govEligibility") },
          ]}
        />
        <span className="rounded-md border border-stone-200 bg-paper px-2.5 py-1 text-sm text-steel">
          {t("pending", { count: pendingHeaderCount })}
        </span>
        {/* reconsider-earns-keep — a headline count chip for the auto-reject
            safety valve, so an audit isn't buried in a collapsed section at the
            bottom. Clicking opens + scrolls to the reconsider queue. Amber: a
            standing "these need a second look", not a success signal. */}
        {reconsiderCount > 0 ? (
          <button
            type="button"
            onClick={onRevealReconsider}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-sm font-semibold text-amber-800 hover:bg-amber-100"
          >
            <RotateCcw size={13} aria-hidden /> {t("reconsiderChip", { count: reconsiderCount })}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onOpenRules}
          title={t("rulesTitle")}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1 text-sm font-semibold text-steel hover:bg-stone-50"
        >
          <SlidersHorizontal size={13} /> {t("rulesButton")}
        </button>
      </div>
    </header>
  );
}
