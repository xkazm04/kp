"use client";

// The decisions ledger's cells: the fit score, what the AI proposes (a verdict, or
// the money on an offer), the pipeline stage chip, the batch checkbox, and the
// Decision column's three icon doors — quick accept, quick reject, and the modal
// for a considered call.

import { Check, CheckSquare, Square, SquareArrowOutUpRight, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { StatusChip } from "@/app/_components/StatusChip";
import { pipelineStageTone } from "@/app/_lib/status-tone";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { useNumberFormat } from "@/app/_lib/use-number-format";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { ColumnFilter, type Option } from "@/app/_components/table/ColumnFilter";
import { ColumnHead } from "@/app/_components/table/ColumnHead";
import type { SortState } from "@/app/_components/table/useTableSort";
import type { LedgerFilters } from "./decisionsLedgerTable";
import { RecBadge } from "../DecisionsShared";
import type { LedgerRow } from "./decisionsLedgerModel";

export const CELL = "px-3 py-2 align-middle";
export const HEAD = `${META_LABEL} px-3 py-2 text-left`;
const ICON_BTN = "focus-ring inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border transition-colors disabled:cursor-wait disabled:opacity-50";

export function ScoreCell({ score }: { score: number | null }) {
  return score != null ? <ScoreBadge score={score} /> : <span className="text-sm text-steel">—</span>;
}

/** Where on the board this person stands — the same chip the board draws. */
export function PipelineCell({ stage }: { stage: string }) {
  const enumLabel = useEnumLabel();
  return <StatusChip tone={pipelineStageTone(stage)} label={enumLabel("stage", stage)} />;
}

/** What the AI proposes: the verdict, or on an offer the amount (an unpriced draft
 *  says so rather than showing 0). */
export function ProposalCell({ row }: { row: LedgerRow }) {
  const t = useTranslations("decisions.aiReview");
  const n = useNumberFormat();
  if (row.offer) {
    return row.offer.amount == null ? (
      <span className="text-sm text-amber-800" title={t("unpricedTitle")}>
        {t("unpricedAmount")}
      </span>
    ) : (
      <span className="nums font-serif text-base text-ink">
        {n.grouped(row.offer.amount)}
        {row.offer.currency ? ` ${row.offer.currency}` : ""}
      </span>
    );
  }
  return <RecBadge rec={row.recommendation ?? undefined} />;
}

export function SelectCell({ row, selected, onToggle }: { row: LedgerRow; selected: boolean; onToggle?: () => void }) {
  const t = useTranslations("decisions.aiReview");
  if (!onToggle) return <span className="inline-block w-4" aria-hidden />;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={t("select", { name: row.entry.candidateLabel })}
      onClick={onToggle}
      className="focus-ring inline-flex cursor-pointer rounded p-0.5"
    >
      {selected ? <CheckSquare size={15} className="text-coral" aria-hidden /> : <Square size={15} className="text-steel" aria-hidden />}
    </button>
  );
}

/** The Decision column: accept ✓ and reject ✕ apply the AI's proposal right here;
 *  offer rows hide ✓ so the deadline is chosen in the candidate modal (batch
 *  already excludes offers). The third door opens that modal. Hidden in select
 *  mode — the batch bar decides. */
export function DecisionCell({
  row,
  onAccept,
  onReject,
  onDecide,
  hidden,
}: {
  row: LedgerRow;
  onAccept: () => void;
  onReject: () => void;
  onDecide: () => void;
  hidden: boolean;
}) {
  const t = useTranslations("decisions.ledger");
  const name = row.entry.candidateLabel;
  return (
    <span className="inline-flex items-center justify-end gap-1">
      {hidden ? null : (
        <>
          {row.kind === "offer" ? null : (
            <button
              type="button"
              data-sim-click="accept"
              onClick={onAccept}
              aria-label={t("quickAccept", { name })}
              title={t("quickAccept", { name })}
              className={`${ICON_BTN} border-moss/40 bg-white text-moss hover:bg-moss/10`}
            >
              <Check size={15} aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={onReject}
            aria-label={t("quickReject", { name })}
            title={t("quickReject", { name })}
            className={`${ICON_BTN} border-coral/40 bg-white text-coral hover:bg-coral/5`}
          >
            <X size={15} aria-hidden />
          </button>
        </>
      )}
      <button
        type="button"
        onClick={onDecide}
        aria-label={t("decideAria", { name })}
        title={t("decideAria", { name })}
        aria-haspopup="dialog"
        className={`${ICON_BTN} border-stone-200 bg-white text-ink hover:border-coral/40`}
      >
        <SquareArrowOutUpRight size={15} aria-hidden />
      </button>
    </span>
  );
}

export type LedgerCol = "name" | "role" | "pipeline" | "score" | "recommended";

/** The sortable, filterable head: the candidate search, and selects on role,
 *  pipeline stage and the AI's proposal. Score sorts and has no filter. */
export function LedgerHead({
  withSelect,
  titles,
  sort,
  onSort,
  filters,
  setFilter,
  options,
}: {
  withSelect: boolean;
  titles: Record<LedgerCol, string>;
  sort: SortState<LedgerCol>;
  onSort: (col: LedgerCol) => void;
  filters: LedgerFilters;
  setFilter: (key: keyof LedgerFilters) => (value: string) => void;
  options: { role: Option[]; stage: Option[]; recommended: Option[] };
}) {
  const t = useTranslations("decisions.ledger");
  return (
    <thead className="bg-paper">
      <tr>
        {withSelect ? <th scope="col" className={`${CELL} w-8`} /> : null}
        <ColumnHead title={titles.name} sortCol="name" sort={sort} onSort={onSort} className={CELL}>
          <ColumnFilter title={titles.name} value={filters.name} onChange={setFilter("name")} mode="search" trigger="icon" />
        </ColumnHead>
        <ColumnHead title={titles.role} sortCol="role" sort={sort} onSort={onSort} className={CELL}>
          <ColumnFilter title={titles.role} value={filters.role} onChange={setFilter("role")} options={options.role} trigger="icon" />
        </ColumnHead>
        <ColumnHead title={titles.pipeline} sortCol="pipeline" sort={sort} onSort={onSort} className={CELL}>
          <ColumnFilter title={titles.pipeline} value={filters.stage} onChange={setFilter("stage")} options={options.stage} trigger="icon" />
        </ColumnHead>
        <ColumnHead title={titles.score} sortCol="score" sort={sort} onSort={onSort} className={`${CELL} w-24`} />
        <ColumnHead title={titles.recommended} sortCol="recommended" sort={sort} onSort={onSort} className={CELL}>
          <ColumnFilter title={titles.recommended} value={filters.recommended} onChange={setFilter("recommended")} options={options.recommended} trigger="icon" />
        </ColumnHead>
        <th scope="col" className={`${HEAD} w-32 text-right`}>{t("colDecide")}</th>
      </tr>
    </thead>
  );
}
