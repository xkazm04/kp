"use client";

import { Fragment } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DataTable, Mark, Note, Section, formatCount, type Column, type PartState } from "@/app/_components/kit";
import { ShapeMark, StageCells, StageCellsHead } from "@/app/_components/kit/graphic";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { useRelativeTime } from "../pipelineEventCatalog";
import type { PipelineTabState } from "../usePipelineTabState";
import type { PipelineKit } from "./usePipelineKit";
import { roleTone } from "./pipelineKitModel";
import { stageName } from "./pipelineKitMoves";
import { atReadCap, BOARD_READ_CAP, type RoleRow } from "./rolesBoardModel";
import "./pipelineRoles.css";

/**
 * Level 1, "Roles": one row per role, a cell per stage (a numeral, a capped bead strip, "+N", the
 * waiting-on-you count), then the role's total, how many wait on you, and its last move. The first row
 * is "All roles", the same columns summed. A row opens that role's pipeline under the board (level 2);
 * a cell opens it on that stage; the open row is marked and its second press closes it. Windowed: a
 * board of 60 roles keeps about 13 rows in the DOM.
 */
export function PipelineKitRoles({ s, k, status }: { s: PipelineTabState; k: PipelineKit; status: PartState }) {
  const t = useTranslations("pipeline.kit");
  const tb = useTranslations("pipeline.board");
  const tt = useTranslations("pipeline.tab");
  const locale = useLocale();
  const enumLabel = useEnumLabel();
  const ago = useRelativeTime();
  const n = (v: number) => formatCount(v, locale);
  const stages = s.axis.map((st) => ({ id: st.id, label: stageName(st.id, s.axis, (x) => enumLabel("stage", x)), tone: roleTone(st.role) }));
  const label = new Map(stages.map((st) => [st.id, st.label]));
  const roles = k.board.length - 1;
  const rows = k.board[0]?.total ? k.board : [];
  const titleOf = (r: RoleRow) => (r.all ? t("allRoles") : r.title ?? t("noRole"));
  // The second line: the role's area, then how many the AI is working on (the retired Subway row's
  // AI indicator, lineAttention); the full sentence rides the line's tip.
  const sub = (r: RoleRow) =>
    r.all ? (
      t("allRolesSub", { roles })
    ) : (
      <small data-tip={r.ai ? tb("waitingAi", { count: r.ai }) : undefined}>
        {[r.family ? enumLabel("family", r.family) : null, r.ai ? t("withAi", { count: r.ai }) : null].filter(Boolean).join(" · ") || t("areaNone")}
      </small>
    );

  const columns: Column[] = [
    { id: "mark", label: "", track: "mark" },
    { id: "name", label: tb("position"), track: "name", primary: true },
    { id: "stages", label: tb("gridAria"), head: <StageCellsHead stages={stages} />, track: "meta" },
    { id: "total", label: t("colTotal"), track: "meta+1", numeric: true },
    { id: "waiting", label: t("colWaiting"), track: "fig", numeric: true, tip: t("waitingTip") },
    { id: "last", label: t("colLast"), track: "time", numeric: true, tip: t("colLastTip") },
  ];
  const cells = (r: RoleRow) => [
    r.waiting ? <Mark key="mark" kind="needs" tip={t("chipWaiting")} /> : r.all ? <ShapeMark key="mark" shape="solid" tone="accepted" tip={null} /> : <Mark key="mark" kind="wait" />,
    <Fragment key="name">{titleOf(r)}{r.all ? <small>{sub(r)}</small> : sub(r)}</Fragment>,
    <StageCells
      key="stages"
      picked={r.id === k.role ? k.layer : null}
      onCell={(stage) => k.openScope(r.id, stage)}
      cells={r.cells.map((c) => {
        const where = tb("cellAria", { position: titleOf(r), stage: label.get(c.stage) ?? c.stage, count: c.count });
        return { id: c.stage, count: c.count, waiting: c.waiting, beads: c.beads, more: c.more, aria: c.waiting ? `${where} · ${tb("cellWaiting", { count: c.waiting })}` : where };
      })}
    />,
    n(r.total),
    r.waiting ? <span key="waiting" className="k-needs-t">{n(r.waiting)}</span> : <span key="waiting" className="k-absent">{n(0)}</span>,
    r.lastMove ? ago(r.lastMove) : <span key="last" className="k-absent" data-tip={t("lastNone")} tabIndex={-1}>—</span>,
  ];

  const legend = (
    <span className="k-g-legend">
      <span><ShapeMark shape="solid" tone="screened" tip={null} />{t("legendWalked")}</span>
      <span><ShapeMark shape="ring" tone="screened" tip={null} />{t("legendPlaced")}</span>
      <span><i className="pk-roles__halo" aria-hidden="true" />{t("legendWaiting")}</span>
    </span>
  );

  return (
    <Section
      id="pipeline-kit-roles"
      title={t("rolesTitle")}
      count={roles === k.roles.length ? n(roles) : t("listCount", { shown: roles, total: k.roles.length })}
      stateMark={legend}
    >
      {status === "ready" && atReadCap(k.entries.length) ? <Note tone="caution">{t("capNote", { cap: BOARD_READ_CAP })}</Note> : null}
      <div className="pk-roles">
        <DataTable
          label={tb("gridAria")}
          rows={rows}
          columns={columns}
          cells={cells}
          rowKey={(r) => r.id}
          rowState={(r) => (r.waiting && !r.all ? ["needs"] : [])}
          visibleRows={k.role ? 5 : 10}
          metaSplit="minmax(0,1fr) 72px"
          selectedKey={k.role}
          onSelect={(id) => (id === k.role ? k.closeScope() : k.openScope(id))}
          state={status}
          emptyText={tt("noMatch")}
          errorText={tt("loadFailed")}
          onRetry={() => void s.load()}
          resetKey={`${s.visibleScope}|${k.needsOnly ? 1 : 0}`}
        />
      </div>
    </Section>
  );
}
