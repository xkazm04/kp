"use client";

import { useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import type { CohortDimension } from "../../cohortTypes";
import { entryOf, moveCell, summaryCount, voiceOf, type Cell, type HeadClaim, type MatrixColumn, type MatrixGroup } from "./matrixModel";
import { FootMark, GridPress, HeadMark, RowHead, StatusMark, type ColMarks } from "./MatrixCells";
import { usePhrase } from "./usePhrase";
import { useMatrixWords } from "./useMatrixWords";

/** The workspace's chord window: a key within it after a bare `g` belongs to the `g` chord. */
const CHORD_WINDOW_MS = 1500;
const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

/**
 * The matrix itself: an ARIA grid (sticky head of names, sticky column of criteria, sticky foot of
 * ratings) with ONE tab stop that the arrows, j / k, Home / End and PageUp / PageDown move. Pressing
 * any cell reads that candidate (onFocusMember); a step to another column does the same.
 */
export function MatrixGrid({ d, columns, groups, head, focusId, refId, differs, onFocusMember }: {
  d: CohortDimension;
  columns: readonly MatrixColumn[];
  groups: readonly MatrixGroup[];
  head: HeadClaim;
  focusId: string | null;
  refId: string | null;
  differs: ReadonlySet<string>;
  onFocusMember: (id: string | null) => void;
}) {
  const t = useTranslations("analyzeCohort.layerMatrix");
  const tDim = useTranslations("analyzeCohort.dims");
  const w = useMatrixWords();
  const phrase = usePhrase();
  const root = useRef<HTMLDivElement>(null);
  const lastG = useRef(0);
  const focusCol = Math.max(0, columns.findIndex((c) => c.member.memberId === focusId));
  const [active, setActive] = useState<Cell>({ row: 0, col: focusCol });
  const rows = groups.flatMap((g) => g.rows);
  const nRows = rows.length + 4;
  const footRow = nRows - 1;

  // The reader's column moved from outside (the world's corridor, a press in the readout): the tab stop follows it.
  // (Adjusted during render, React's pattern for state derived from a changed prop.)
  const [syncedCol, setSyncedCol] = useState(focusCol);
  if (syncedCol !== focusCol) {
    setSyncedCol(focusCol);
    setActive((a) => ({ ...a, col: focusCol }));
  }

  const marks: ColMarks[] = columns.map((c, i) => ({
    id: c.member.memberId,
    on: c.member.memberId === focusId,
    ref: c.member.memberId === refId,
    pending: c.state === "pending",
    lead: head?.kind === "clears" && head.leader === c.member.memberId,
    noise: head?.kind === "noise" && c.state === "rated" && i < head.count,
  }));
  const at = (r: number, c: number) => `${r}:${c}`;
  const tab = (r: number, c: number) => active.row === r && active.col === c;
  const press = (id: string) => () => onFocusMember(id);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) return;
    if (e.key.toLowerCase() === "g" && !e.shiftKey) {
      lastG.current = Date.now();
      return;
    }
    const next = moveCell(active, e.key, nRows, columns.length);
    if (!next) return;
    if ((e.key === "j" || e.key === "k") && lastG.current && Date.now() - lastG.current < CHORD_WINDOW_MS) {
      lastG.current = 0;
      return;
    }
    e.preventDefault();
    root.current?.querySelector<HTMLElement>(`[data-mx-at="${at(next.row, next.col)}"]`)?.focus();
    setActive(next);
    if (next.col !== active.col) onFocusMember(columns[next.col].member.memberId);
  };
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const key = e.target instanceof HTMLElement ? e.target.dataset.mxAt : undefined;
    if (!key) return;
    const [row, col] = key.split(":").map(Number);
    setActive({ row, col });
  };

  const style = { "--mx-cols": columns.length } as CSSProperties;
  return (
    <div className="mx-scroll" ref={root}>
      <div role="grid" className="mx-grid" style={style} aria-label={t("grid", { dimension: tDim(d) })} aria-rowcount={nRows} onKeyDown={onKeyDown} onFocus={onFocus}>
        <div role="row" className="mx-row mx-row--head">
          <div role="columnheader" className="mx-corner">
            <span className="mx-corner__title">{t("corner")}</span>
            <span className="mx-corner__order">{d === "salary" ? t("orderSalary") : t("order", { dimension: tDim(d) })}</span>
            {head ? <span className="mx-corner__claim" data-kind={head.kind}>{w.headLine(head, columns)}</span> : null}
          </div>
          {columns.map((c, i) => (
            <GridPress key={c.member.memberId} role="columnheader" kind="head" at={at(0, i)} tab={tab(0, i)} col={marks[i]} label={w.colLabel(c, d, marks[i], columns)} onPress={press(c.member.memberId)}>
              <HeadMark col={marks[i]} name={c.member.label} decoy={c.member.decoyOf != null} />
            </GridPress>
          ))}
        </div>
        {groups.map((g) => (
          <div role="rowgroup" key={g.kind} className="mx-group">
            <div role="row" className="mx-row mx-row--kind">
              <div role="rowheader" className="mx-kind">
                {t(`kind.${g.kind}`)} <span className="mx-kind__order">{t("groupOrder")}</span>
              </div>
            </div>
            {g.rows.map((row) => {
              const r = rows.indexOf(row) + 1;
              const voice = voiceOf(d, g.kind);
              const name = phrase(row.criterion.phrase);
              return (
                <div role="row" key={row.criterion.id} className="mx-row">
                  <RowHead
                    phrase={name}
                    summary={t(`summary.${voice}`, { n: summaryCount(voice, row.stats), rated: row.stats.rated })}
                    stats={row.stats}
                    differs={differs.has(row.criterion.id)}
                    diffLabel={w.diffLabel(columns, focusId, refId)}
                    alike={t("alike")}
                  />
                  {columns.map((c, i) => {
                    const e = entryOf(c.member, d, row.criterion.id);
                    const label = w.cellLabel(c.member.label, name, voice, e);
                    return (
                      <GridPress key={c.member.memberId} kind="cell" at={at(r, i)} tab={tab(r, i)} col={marks[i]} label={label} onPress={press(c.member.memberId)} extra={{ "data-status": e?.status ?? "pending", "data-differs": differs.has(row.criterion.id) ? "" : undefined }}>
                        <StatusMark status={e?.status ?? "pending"} note={e?.note != null} />
                      </GridPress>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
        {(["pros", "cons"] as const).map((tone, k) => (
          <div role="row" key={tone} className={`mx-row mx-row--count mx-row--${tone}`}>
            <div role="rowheader" className="mx-rowhead mx-rowhead--count">{t(`rows.${tone}`)}</div>
            {columns.map((c, i) => {
              const n = c.member.why[d]?.[tone].length ?? null;
              return (
                <GridPress key={c.member.memberId} kind="count" at={at(rows.length + 1 + k, i)} tab={tab(rows.length + 1 + k, i)} col={marks[i]} label={n == null ? w.pendingLabel(c.member.label) : t(`count.${tone}`, { name: c.member.label, n })} onPress={press(c.member.memberId)}>
                  <span className="mx-count k-nums">{n ?? " "}</span>
                </GridPress>
              );
            })}
          </div>
        ))}
        <div role="row" className="mx-row mx-row--foot">
          <div role="rowheader" className="mx-rowhead mx-rowhead--count">{t("rows.rating")}</div>
          {columns.map((c, i) => (
            <GridPress key={c.member.memberId} kind="foot" at={at(footRow, i)} tab={tab(footRow, i)} col={marks[i]} label={w.footLabel(c, d)} onPress={press(c.member.memberId)}>
              <FootMark rating={c.rating} tier={c.member.cells[d].tier} comment={c.member.cells[d].comment != null} />
            </GridPress>
          ))}
        </div>
      </div>
    </div>
  );
}
