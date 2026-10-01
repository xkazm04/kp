"use client";

// The Docket's board: role groups as a list you can work in. One row per waiting recommendation:
// name (opens the reading), stage, fit score, what the AI proposes, and three doors (accept the
// proposal, reject, open). A reject is ARMED by the caller (the 8-second commit window), never
// written here. Absence is stated, not zeroed: an unscored row is "—", an AI that recorded no
// proposal is "none recorded" (not "hold"), a score older than its JD says why.
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit/Button";
import { Mark } from "@/app/_components/kit/Mark";
import type { MarkKind } from "@/app/_components/kit/types";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { useNumberFormat } from "@/app/_lib/use-number-format";
import type { Entry } from "@/app/features/shared/decisionsTypes";
import { SelectCell } from "../ledger/SelectCell";
import type { LedgerRow } from "../ledger/decisionsLedgerModel";
import { proposalOf, type DocketGroup, type DocketProposal } from "./docketModel";
import "./docket.css";

const PROPOSAL_MARK: Record<DocketProposal, MarkKind | null> = { advance: "ok", hold: "wait", reject: "fail", offer: null, none: "unknown" };

export type DocketRowHandlers = {
  selectMode: boolean;
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (e: Entry) => void;
  leavingWrapClass: (e: Entry) => string;
  /** The reading: the candidate modal with the decision attached. */
  onDecide: (e: Entry) => void;
  act: (e: Entry, action: "accept" | "reject") => void;
};

export function DocketRowView({ row, h }: { row: LedgerRow; h: DocketRowHandlers }) {
  const t = useTranslations("decisions");
  const enumLabel = useEnumLabel();
  const n = useNumberFormat();
  const { entry } = row;
  const p = proposalOf(row);
  const mark = PROPOSAL_MARK[p];
  const name = entry.candidateLabel;
  const selected = h.selectedIds.has(entry.id);
  return (
    <li data-sim-entry={entry.id} className={`dk-row ${selected ? "is-sel" : ""} ${h.leavingWrapClass(entry)}`}>
      <span className="dk-row__ck">
        {h.selectMode ? <SelectCell row={row} selected={selected} onToggle={row.eligible ? () => h.onToggleSelect(entry) : undefined} /> : null}
      </span>
      <Button variant="link" label={name} className="dk-row__name" onClick={() => h.onDecide(entry)} aria-haspopup="dialog" aria-label={t("ledger.decideAria", { name })} />
      <span className="dk-stage" data-s={entry.stage}>{enumLabel("stage", entry.stage)}</span>
      {row.score != null ? (
        <span className="dk-score nums">
          {row.score}
          {row.staleSince ? <Mark kind="caution" tip={t("aiReview.jdEditedTitle")} /> : null}
        </span>
      ) : (
        <span className="dk-score dk-score--none" aria-label={t("docket.neverScored")}>—</span>
      )}
      <span className="dk-prop" data-p={p}>
        {mark ? <Mark kind={mark} hollow={p === "none"} /> : null}
        {p === "offer" ? (
          row.offer?.amount != null ? (
            <span className="nums">{n.grouped(row.offer.amount)}{row.offer.currency ? ` ${row.offer.currency}` : ""}</span>
          ) : (
            t("aiReview.unpricedAmount")
          )
        ) : p === "none" ? (
          t("docket.noProposal")
        ) : (
          enumLabel("recommendation", p)
        )}
      </span>
      <span className="dk-acts">
        {h.selectMode ? null : (
          <>
            {row.kind === "offer" ? null : (
              <Button iconOnly size="sm" icon="check" label={t("ledger.quickAccept", { name })} className="dk-act dk-act--acc" data-sim-click="accept" onClick={() => h.act(entry, "accept")} />
            )}
            <Button iconOnly size="sm" icon="x" variant="danger" label={t("ledger.quickReject", { name })} className="dk-act" onClick={() => h.act(entry, "reject")} />
          </>
        )}
        <Button iconOnly size="sm" icon="open" label={t("ledger.decideAria", { name })} className="dk-act" data-sim-click="decide" aria-haspopup="dialog" onClick={() => h.onDecide(entry)} />
      </span>
    </li>
  );
}

export function DocketBoard({
  groups,
  onOpenRole,
  ...h
}: DocketRowHandlers & {
  groups: readonly DocketGroup[];
  /** Walk into one role (level 1), from the element that was touched. */
  onOpenRole: (roleKey: string, opener: HTMLElement) => void;
}) {
  const t = useTranslations("decisions");
  return (
    <div className="dk-board">
      {groups.map((g) => (
        <section key={g.key} className="dk-grp" aria-label={g.title}>
          <div className="dk-grp__h">
            <Button variant="link" label={g.title} className="dk-grp__t" onClick={(e) => onOpenRole(g.key, e.currentTarget)} />
            <span className="dk-grp__n">
              {t("ledger.groupCount", { count: g.rows.length })}
              {g.best != null ? <> · {t("ledger.groupBest")} {g.best}</> : null}
              {g.rejects > 0 ? <> · <b>{t("docket.rejectsProposed", { count: g.rejects })}</b></> : null}
            </span>
            <Button variant="link" label={`${t("docket.compare")} ›`} className="dk-grp__go" onClick={(e) => onOpenRole(g.key, e.currentTarget)} aria-label={t("docket.openRole", { role: g.title })} />
          </div>
          <ul className="dk-rows">
            {g.rows.map((r) => (
              <DocketRowView key={r.entry.id} row={r} h={h} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
