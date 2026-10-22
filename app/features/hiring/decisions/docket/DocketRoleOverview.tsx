"use client";

// CX S46 - "Everyone on this role": the role level's side-by-side table of EVERY active candidate
// (the role-view read), one kit DataTable sortable by any single column. There is no total
// column and never will be: the match, the work sample and the interview are different
// instruments, and the section's one line says each is read on its own. Absence is "—" with its
// reason and sorts last, never as 0 (roleOverviewModel.ts).
//
// Nothing is decided here. A row opens the candidate modal (the same door the decide rows use),
// where advance, offer and reject (with its undo window) are the human-gated actions. The tick
// is a page-only shortlist; with two or more ticked, one action hands the selection to the
// existing Group evaluation. Narrow sheets fold Interview first, then Stage and the AI proposal
// (the kit's fold order); Candidate, Match and Work sample never fold.
import { useMemo, useState } from "react";
import { CheckSquare, Square } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ABSENT, Button, DataTable, Mark, Section, type Column } from "@/app/_components/kit";
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
  type OverviewCol,
  type OverviewRow,
} from "./roleOverviewModel";
import type { RoleViewRead } from "./useRoleWorkSamples";

const TRACK: Record<OverviewCol, Column["track"]> = {
  candidate: "name",
  stage: "meta",
  interview: "meta+1",
  match: "fig",
  workSample: "time",
  proposal: "act",
};
// The table's column order is the measure's track order (mark name meta meta+1 fig time act).
const ORDER: readonly OverviewCol[] = ["candidate", "stage", "interview", "match", "workSample", "proposal"];

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

  const columns: Column[] = [
    { id: "tick", label: t("cols.tick"), track: "mark" },
    ...ORDER.map(
      (col): Column => ({
        id: col,
        label: t(`cols.${col}`),
        track: TRACK[col],
        primary: col === "candidate",
        numeric: col === "match",
        head: head(col),
        sort: ariaSort(sort, col),
      }),
    ),
  ];

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

  const cells = (r: OverviewRow) => [
    tick(r),
    <Button
      key="name"
      variant="link"
      label={r.label}
      className="dk-ov__name"
      aria-haspopup="dialog"
      aria-label={t("openAria", { name: r.label })}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(r.entryId);
      }}
    />,
    <span key="stage" className="dk-stage" data-s={r.stage}>{enumLabel("stage", r.stage)}</span>,
    interviewCell(r),
    matchCell(r),
    wsCell(r),
    proposalCell(r),
  ];

  const selection = shortlistSelection(shortlist, rows);
  const actions =
    base.length > 1 ? (
      <>
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
      </>
    ) : null;

  return (
    <Section title={t("title")} count={read.status === "ready" ? base.length : undefined} state={t("note")} actions={actions}>
      <DataTable
        rows={rows}
        columns={columns}
        cells={cells}
        rowKey={(r) => r.entryId}
        visibleRows={10}
        onSelect={(key) => onOpen(key)}
        state={read.status === "loading" ? "loading" : read.status === "failed" ? "error" : "ready"}
        errorText={t("loadFailed")}
        emptyText={hasJob ? t("empty") : t("noJob")}
        label={t("title")}
        resetKey={`${sort.col}:${sort.dir}`}
      />
    </Section>
  );
}
