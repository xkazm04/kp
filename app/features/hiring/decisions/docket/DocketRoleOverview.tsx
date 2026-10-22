"use client";

// CX S46 - "Everyone on this role": the role level's side-by-side table of EVERY active candidate
// (the role-view read), one kit DataTable sortable by any single column. There is no total
// column and never will be: the match, the work sample and the interview are different
// instruments, and the section's one line says each is read on its own. Absence is "—" with its
// reason and sorts last, never as 0 (roleOverviewModel.ts).
//
// The layout is decisions-local, not the kit DataTable: at desktop width it is a one-line-per-person
// grid; below the container breakpoint (docket.css) the same markup folds to a card per person,
// each fact under its own label, so nothing is clipped and the page never scrolls sideways.
//
// Nothing is decided here. A row opens the candidate modal (the same door the decide rows use),
// where advance, offer and reject (with its undo window) are the human-gated actions. The tick
// is a page-only shortlist; with two or more ticked, one action hands the selection to the
// existing Group evaluation. A narrow sheet keeps every column (as cards) rather than dropping one.
import { useMemo, useState, type ReactNode } from "react";
import { CheckSquare, Square } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ABSENT, Button, Mark, Section } from "@/app/_components/kit";
import { BTN_GHOST } from "@/app/_components/ui/recipes";
import { useScoreProvenanceText } from "@/app/_components/ScoreProvenanceLabel";
import { ariaSort, type SortState } from "@/app/_components/table/useTableSort";
import { GROUP_EVAL_CAP } from "@/app/_lib/group-eval-cohort";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { DocketProposal } from "./docketModel";
import { PROPOSAL_MARK } from "./DocketBoard";
import {
  canCompareShortlist,
  nextOverviewSort,
  overviewRows,
  pruneShortlist,
  shortlistSelection,
  sortOverview,
  toggleShortlist,
  OVERVIEW_COLS,
  type OverviewCol,
  type OverviewRow,
} from "./roleOverviewModel";
import type { RoleViewRead } from "./useRoleWorkSamples";

export function DocketRoleOverview({
  read,
  hasJob,
  proposals,
  stageOrder,
  onOpen,
  onCompare,
  compareBusy,
}: {
  read: RoleViewRead;
  /** False for a title-only role: there is no job to read the people of. */
  hasJob: boolean;
  /** Entry id -> what the AI proposes, for the people with a proposal waiting. */
  proposals: ReadonlyMap<string, DocketProposal>;
  stageOrder: readonly string[];
  onOpen: (entryId: string) => void;
  /** Hand an explicit selection to Group evaluation. */
  onCompare: (entryIds: string[]) => void;
  compareBusy: boolean;
}) {
  const t = useTranslations("decisions.docket.overview");
  const tws = useTranslations("decisions.docket.ws");
  const tp = useTranslations("decisions.docket");
  const locale = useLocale();
  const enumLabel = useEnumLabel();
  const provText = useScoreProvenanceText();
  const [sort, setSort] = useState<SortState<OverviewCol>>({ col: "match", dir: "desc" });
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());

  const base = useMemo(
    () => (read.status === "ready" ? overviewRows(read.candidates, proposals, stageOrder) : []),
    [read, proposals, stageOrder],
  );
  const rows = useMemo(() => sortOverview(base, sort, locale), [base, sort, locale]);
  // A tick on someone who left the role (between two reads) is dropped, not compared.
  const shortlist = useMemo(() => pruneShortlist(ticked, base.map((r) => r.entryId)), [ticked, base]);
  const atCap = shortlist.size >= GROUP_EVAL_CAP;

  const head = (col: OverviewCol) => {
    const label = t(`cols.${col}`);
    const active = sort.col === col;
    return (
      <Button
        variant="link"
        size="sm"
        label={label}
        icon={active ? (sort.dir === "asc" ? "up" : "down") : undefined}
        tip={t("sortBy", { column: label })}
        className={`dk-sort${active ? " is-on" : ""}`}
        onClick={() => setSort((prev) => nextOverviewSort(prev, col))}
      />
    );
  };

  const tick = (r: OverviewRow) => {
    const on = shortlist.has(r.entryId);
    const blocked = !on && atCap;
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        aria-disabled={blocked || undefined}
        aria-label={t("tick", { name: r.label })}
        data-tip={blocked ? t("tickCap", { cap: GROUP_EVAL_CAP }) : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (!blocked) setTicked((cur) => toggleShortlist(pruneShortlist(cur, base.map((x) => x.entryId)), r.entryId, GROUP_EVAL_CAP));
        }}
        className={`${BTN_GHOST} cursor-pointer p-0.5`}
      >
        {on ? <CheckSquare size={15} className="text-coral-ink" aria-hidden /> : <Square size={15} className="text-steel" aria-hidden />}
      </button>
    );
  };

  const matchCell = (r: OverviewRow) => {
    if (r.match.score == null) return <span className="dk-cell--none">{ABSENT} {t("matchNone")}</span>;
    const p = r.match.provenance;
    const short = p ? t(`prov.${p.source}`) : null;
    return (
      <span className="dk-cell" data-tip={provText(p) ?? undefined} tabIndex={p ? 0 : undefined}>
        <span className="nums">{r.match.score}</span>
        {short ? <span className="dk-cell__q"> · {short}</span> : null}
      </span>
    );
  };

  const wsCell = (r: OverviewRow) => {
    const ws = r.workSample;
    if (ws.transferScore == null) {
      const reason = ws.reason ?? "not_evaluated";
      return (
        <span className="dk-cell--none" data-tip={tws(`tip.${reason}`)} tabIndex={0}>
          {ABSENT} {tws(`none.${reason}`)}
        </span>
      );
    }
    const hold = ws.ladder?.hold ?? "none";
    const marks = [hold === "held" ? tws("held") : hold === "cleared" ? tws("cleared") : null, ws.grading === "template" ? tws("template") : null].filter(Boolean);
    const tip = [
      tws("tip.score", { score: ws.transferScore }),
      ws.grading === "template" ? tws("tip.template") : tws("tip.graded"),
      hold === "held" ? tws("tip.held") : hold === "cleared" ? tws("tip.cleared") : null,
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <span className="dk-cell" data-hold={hold} data-tip={tip} tabIndex={0}>
        <span className="nums">{ws.transferScore}</span>
        {marks.length > 0 ? <span className="dk-cell__q dk-cell__m"> · {marks.join(" · ")}</span> : null}
      </span>
    );
  };

  const interviewCell = (r: OverviewRow) => {
    const { human, ai, scale } = r.interview;
    const aiPart = ai.average != null ? <span className="dk-cell__q" data-tip={t("aiTip", { scale })} tabIndex={0}> · {t("ivAi", { avg: ai.average })}</span> : null;
    if (human.average == null) {
      return (
        <span className="dk-cell--none">
          {ABSENT} {t(`ivNone.${human.reason}`)}
          {aiPart}
        </span>
      );
    }
    return (
      <span className="dk-cell">
        <span className="nums" data-tip={t("ivTip", { scale, count: human.count })} tabIndex={0}>{human.average}</span>
        <span className="dk-cell__q"> · {t("ivCount", { count: human.count })}</span>
        {aiPart}
      </span>
    );
  };

  const proposalCell = (r: OverviewRow) => {
    const p = r.proposal;
    if (!p) return <span className="dk-cell--none">{ABSENT} {t("proposalNone")}</span>;
    const mark = PROPOSAL_MARK[p];
    return (
      <span className="dk-prop" data-p={p}>
        {mark ? <Mark kind={mark} hollow={p === "none"} /> : null}
        {p === "offer" ? t("offer") : p === "none" ? tp("noProposal") : enumLabel("recommendation", p)}
      </span>
    );
  };

  const lab = (col: OverviewCol) => <span className="dk-ov__lab">{t(`cols.${col}`)}</span>;
  const fact = (col: Exclude<OverviewCol, "candidate">, body: ReactNode) => (
    <div key={col} role="cell" className="dk-ov__cell" data-col={col}>
      {lab(col)}
      {body}
    </div>
  );

  const selection = shortlistSelection(shortlist, rows);
  const actions =
    base.length > 1 ? (
      <div className="dk-ov__bar">
        {shortlist.size > 0 ? <Button variant="ghost" size="sm" label={t("clear")} onClick={() => setTicked(new Set())} /> : null}
        <Button
          variant="secondary"
          size="sm"
          label={t("compare", { count: shortlist.size })}
          tip={t("compareTip", { cap: GROUP_EVAL_CAP })}
          disabled={!canCompareShortlist(shortlist)}
          loading={compareBusy}
          onClick={() => onCompare(selection)}
        />
      </div>
    ) : null;

  const ready = read.status === "ready";
  return (
    <Section
      title={t("title")}
      count={ready ? base.length : undefined}
      status={read.status === "loading" ? "loading" : read.status === "failed" ? "error" : "ready"}
      errorText={t("loadFailed")}
    >
      <div className="dk-ov">
        <p className="dk-ov__note">{t("note")}</p>
        {actions}
        {base.length === 0 ? (
          <p className="dk-ov__note">{hasJob ? t("empty") : t("noJob")}</p>
        ) : (
          <div role="table" aria-label={t("title")}>
            <div role="row" className="dk-ov__head">
              <div role="columnheader" className="dk-ov__tick"><span className="sr-only">{t("cols.tick")}</span></div>
              {OVERVIEW_COLS.map((col) => (
                <div key={col} role="columnheader" aria-sort={ariaSort(sort, col)} data-col={col}>
                  {head(col)}
                </div>
              ))}
            </div>
            {rows.map((r) => (
              <div key={r.entryId} role="row" className="dk-ov__row" onClick={() => onOpen(r.entryId)}>
                <div role="cell" className="dk-ov__tick">{tick(r)}</div>
                <div role="cell" className="dk-ov__who">
                  <Button
                    variant="link"
                    label={r.label}
                    className="dk-ov__name"
                    aria-haspopup="dialog"
                    aria-label={t("openAria", { name: r.label })}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(r.entryId);
                    }}
                  />
                </div>
                <div className="dk-ov__facts">
                  {fact("stage", <span className="dk-stage" data-s={r.stage}>{enumLabel("stage", r.stage)}</span>)}
                  {fact("match", matchCell(r))}
                  {fact("interview", interviewCell(r))}
                  {fact("workSample", wsCell(r))}
                  {fact("proposal", proposalCell(r))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}
