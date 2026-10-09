"use client";

import { useId, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import type { CohortDimension, CohortView, DimensionCriterion, MemberDimensionWhy } from "../../cohortTypes";
import { CommentMark, DecoyMark, MemberName, MemberPress } from "../../dimensions/dimensionParts";
import { consFor, headOf, splitShared, type LedgerFilter, type LedgerRow as Row, type PositionKind } from "./ledgerModel";
import { CellReasons } from "./LedgerReasons";
import { LedgerDetail } from "./LedgerDetail";
import { useCohortLabel } from "../../dimensions/useCohortLabel";
import { usePhrase } from "./usePhrase";

/**
 * The quiet third line: context that neither earns nor costs, two at most, the rest counted. Context the
 * first row carries too ("senior level matches the target" on every line) is left to the expansion.
 */
function NotesLine({ row, first }: { row: Row; first: MemberDimensionWhy | null }) {
  const t = useTranslations("analyzeCohort.layerLedger");
  const phrase = usePhrase();
  const { items, more } = headOf(splitShared(row.why.notes, first?.notes ?? null).distinct, 2);
  if (!items.length) return null;
  return (
    <p className="lg-notes">
      <span className="lg-notes__k">{t("notes")}</span>
      {items.map((r, i) => (
        <span key={i} className="lg-notes__item">
          {phrase(r.phrase)}
        </span>
      ))}
      {more > 0 ? <span className="lg-notes__item">{phrase({ key: "more", params: { n: more } })}</span> : null}
    </p>
  );
}

/**
 * One rated candidate as a ledger line: where they stand (and what that position may claim), who they
 * are, the rating with its tier and its distance from the top, the one-line why, the decisive pros and
 * cons, the notes as a quiet third line, and, expanded, every reason with its evidence and the anatomy.
 */
export function LedgerRow({ row, first, view, dimension, kind, filter, criteria, focusId, stop, expanded, onToggle, onFocusMember, onOpenReport }: {
  row: Row;
  /** The first row's why, which this row's pros and cons are read against; null on the first row and where no rank is claimed. */
  first: MemberDimensionWhy | null;
  view: CohortView;
  dimension: CohortDimension;
  kind: PositionKind;
  filter: LedgerFilter;
  criteria: readonly DimensionCriterion[];
  focusId: string | null;
  stop: boolean;
  expanded: boolean;
  onToggle: () => void;
  onFocusMember: (id: string | null) => void;
  onOpenReport: (slug: string) => void;
}) {
  const t = useTranslations("analyzeCohort.layerLedger");
  const phrase = usePhrase();
  const label = useCohortLabel();
  const detailId = useId();
  const m = row.member;
  const cell = m.cells[dimension];
  const on = focusId === m.memberId;
  const pros = splitShared(row.why.pros, first?.pros ?? null);
  const prosHead = headOf(pros.distinct);
  const cons = filter === "mustMiss" ? splitShared(consFor(row, filter, criteria, dimension), null) : splitShared(row.why.cons, first?.cons ?? null);
  const consHead = headOf(cons.distinct, filter === "all" ? undefined : 6);
  const meter = { "--v": row.rating, "--lo": cell.band?.lo ?? row.rating, "--hi": cell.band?.hi ?? row.rating } as CSSProperties;
  return (
    <li className="lg-row" data-lg-row={m.memberId} data-on={on ? "" : undefined} data-noise={row.noise ? "" : undefined} data-lead={row.lead ? "" : undefined} data-open={expanded ? "" : undefined}>
      <MemberPress
        member={m}
        focusId={focusId}
        stop={stop}
        onFocusMember={onFocusMember}
        className="lg-pos"
        label={t("press", { name: m.label, kind, position: row.position, tied: row.tied && kind === "rank" ? "yes" : "no", rating: row.rating })}
      >
        <span className="lg-pos__n k-nums">{row.position}</span>
        {row.tied && kind === "rank" ? <span className="lg-pos__tag">{t("tied")}</span> : null}
        {row.lead ? <span className="lg-pos__tag lg-pos__tag--lead">{t("lead")}</span> : null}
        {row.noise && !first ? <span className="lg-pos__tag lg-pos__tag--noise">{t("noise")}</span> : null}
      </MemberPress>
      <div className="lg-who">
        <MemberName member={m} onOpenReport={onOpenReport} />
        <DecoyMark member={m} view={view} />
        {on ? <span className="sr-only">{t("focused")}</span> : null}
      </div>
      {/* salary is never ranked: its line shows the figure itself, and no strong/weak word that would read as a verdict */}
      <div className="lg-rate" data-tier={dimension === "salary" ? "neutral" : row.tier}>
        <span className="lg-rate__n k-nums">{row.rating}</span>
        {dimension === "salary" ? (
          <span className="lg-rate__tier lg-rate__figure k-nums">{label(cell.label)}</span>
        ) : (
          <span className="lg-rate__tier">{t(`tier.${row.tier}`)}</span>
        )}
        <CommentMark name={m.label} text={cell.comment} />
        <span className="lg-meter" style={meter} data-band={cell.band ? "" : undefined} aria-hidden />
        {row.gap != null ? <span className="lg-rate__gap k-nums">{t("gap", { gap: row.gap })}</span> : null}
      </div>
      <p className="lg-why">
        <span className="sr-only">{t("col.why")}: </span>
        {phrase(row.why.why)}
      </p>
      {filter === "cons" ? null : (
        <div className="lg-pros">
          <span className="sr-only">{t("col.pros")}</span>
          <CellReasons tone="pro" items={prosHead.items} more={prosHead.more} shared={pros.shared} sharedPoints={pros.sharedPoints} empty={t("noPros")} />
        </div>
      )}
      <div className="lg-cons">
        <span className="sr-only">{t("col.cons")}</span>
        <CellReasons tone="con" items={consHead.items} more={consHead.more} shared={cons.shared} sharedPoints={cons.sharedPoints} empty={t("noCons")} />
      </div>
      <Button
        className="lg-tog"
        size="sm"
        variant="ghost"
        iconOnly
        icon={expanded ? "up" : "down"}
        label={t(expanded ? "collapse" : "expand", { name: m.label })}
        aria-expanded={expanded}
        aria-controls={expanded ? detailId : undefined}
        onClick={onToggle}
      />
      <NotesLine row={row} first={first} />
      {expanded ? <LedgerDetail id={detailId} why={row.why} dimension={dimension} /> : null}
    </li>
  );
}
