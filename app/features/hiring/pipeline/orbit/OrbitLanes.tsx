"use client";

import { useState, type Ref } from "react";
import { Button } from "@/app/_components/kit";
import type { StageDef } from "@/app/features/shared/pipelineTypes";
import { ABSENCES, type Absence, type LensId, type OrbitGroup, type OrbitRole } from "./orbitModel";
import { Bead, OrbitMark, type OrbitMarkKind, Sep } from "./OrbitMarks";
import { cx } from "./orbitCx";
import type { OrbitWords } from "./orbitWords";

/** Beads drawn per cell before "+N": past it a bead is texture, and the count beside it is the fact. */
export const BEAD_CAP = 60;
/** Empty-role chips shown per reason before "Show all". */
const CHIP_CAP = 12;

type Props = {
  group: OrbitGroup;
  lens: LensId;
  axis: readonly StageDef[];
  words: OrbitWords;
  /** Each column's aging cadence in days (0 = never ages), in axis order. */
  sla: readonly number[];
  ring: number | null;
  selRole: string | null;
  selStage: string | null;
  prev: OrbitGroup | null;
  next: OrbitGroup | null;
  flying: boolean;
  lanesRef: Ref<HTMLDivElement>;
  onRole: (key: string) => void;
  onCell: (key: string, stage: string) => void;
  onBack: () => void;
  onSibling: (key: string) => void;
  onEditSla: () => void;
};

export function roleMark(r: Pick<OrbitRole, "act" | "wait" | "aging" | "absence">): OrbitMarkKind {
  if (r.act === 0) return r.absence ?? "vacant";
  return r.wait ? "needs" : r.aging ? "late" : "moving";
}

/**
 * Level 1: a group unrolled into lanes. One row per live role (most waiting first), one cell per stage
 * holding that stage's count and a bead per person, the beads the orbit's dots fly to. The role's TITLE
 * opens its whole ladder; a CELL opens that role's candidates on that stage. Empty roles follow as chips
 * grouped by why they are empty, each opening the role (which says so).
 */
export function OrbitLanes({ group: g, lens, axis, words, sla, ring, selRole, selStage, prev, next, flying, lanesRef, onRole, onCell, onBack, onSibling, onEditSla }: Props) {
  const { t, n } = words;
  const [openAbs, setOpenAbs] = useState<Partial<Record<Absence, boolean>>>({});
  const live = g.roles.filter((r) => r.act > 0);
  const label = words.group(lens, g.key);

  return (
    <div ref={lanesRef} className={cx("ob-lanes", flying && "is-flying")} data-role="orbit-lanes">
      <div className="ob-ghead">
        <Button label={t("backToOrbit")} icon="left" variant="ghost" size="sm" onClick={onBack} tip={t("backTip")} />
        <div className="ob-ghead__t">
          <h2 id="ob-gtitle" data-role="orbit-group-title">{label}</h2>
          <p>
            {g.wait ? <span className="ob-w"><OrbitMark kind="needs" small />{t("waitingOnHuman", { count: g.wait })}</span> : null}
            {g.wait ? " · " : null}
            {g.aging ? <span className="ob-a"><OrbitMark kind="late" small />{t("overSla", { count: g.aging })}</span> : null}
            {g.aging ? " · " : null}
            {t("groupFacts", { people: g.act, live: g.live, roles: g.roles.length, hired: g.hired })}
            {g.target ? ` ${t("ofTarget", { target: g.target })}` : ""}
          </p>
        </div>
        <div className="ob-ghead__sibs">
          {prev ? <Button label={`← ${words.group(lens, prev.key)}`} variant="secondary" size="sm" onClick={() => onSibling(prev.key)} /> : null}
          {next ? <Button label={`${words.group(lens, next.key)} →`} variant="secondary" size="sm" onClick={() => onSibling(next.key)} /> : null}
        </div>
      </div>

      <div className="ob-grid" role="table" aria-label={t("lanesAria", { group: label })} style={{ ["--ob-cols" as string]: axis.length }}>
        <div className="ob-chead" role="row">
          <span role="columnheader">
            <b>{t("colRole")}</b>
            <small>{t("colRoleSub")}</small>
          </span>
          {axis.map((st, i) => (
            <span key={st.id} role="columnheader" className={cx(ring === i && "is-ring")}>
              <b>{words.stage(st.id)}</b>
              <small>{sla[i] ? t("slaDays", { count: sla[i] }) : t("slaNone")}</small>
            </span>
          ))}
        </div>
        <div className="ob-gbody" role="rowgroup">
          {live.length === 0 ? <p className="ob-note">{t("nobodyActive")}</p> : null}
          {live.map((r) => {
            const rowCls = cx("ob-lane", r.wait && "is-needs", selRole === r.key && "is-selected");
            const titleCls = cx("ob-lane__title", selRole === r.key && selStage == null && "is-on");
            const sub = [r.city ?? r.job?.location, r.seniority ? words.enumLabel("seniority", r.seniority) : null, statusWord(words, r)].filter(Boolean).join(" · ");
            return (
              <div key={r.key} className={rowCls} role="row" data-role-key={r.key}>
                <span className="ob-lane__name" role="rowheader">
                  <OrbitMark kind={roleMark(r)} />
                  <button type="button" className={titleCls} onClick={() => onRole(r.key)} aria-label={t("openLadderAria", { role: r.title, people: r.act })}>
                    {r.title}
                  </button>
                  <small>{sub}</small>
                  <span className="ob-lane__f">
                    {r.wait ? <span className="ob-w"><OrbitMark kind="needs" small />{n(r.wait)}</span> : null}
                    {r.aging ? <span className="ob-a"><OrbitMark kind="late" small />{n(r.aging)}</span> : null}
                    <span className="ob-q"><Sep />{r.target != null ? t("hiredOf", { hired: r.hired, target: r.target }) : t("hiredN", { count: r.hired })}</span>
                  </span>
                </span>
                {axis.map((st, si) => {
                  const people = r.people.filter((x) => x.si === si);
                  const on = selRole === r.key && selStage === st.id;
                  const cellCls = cx("ob-cell", people.length === 0 && "is-zero", on && "is-on", ring === si && "is-ring");
                  return (
                    <span key={st.id} role="cell" className="ob-cell__wrap">
                      <button
                        type="button"
                        className={cellCls}
                        onClick={() => onCell(r.key, st.id)}
                        aria-label={t("cellAria", { role: r.title, stage: words.stage(st.id), count: people.length, waiting: r.st[si].wait, late: r.st[si].aging })}
                        aria-pressed={on}
                      >
                        <span className="ob-cell__n">
                          {n(people.length)}
                          {r.st[si].wait ? <span className="ob-w"><OrbitMark kind="needs" small />{n(r.st[si].wait)}</span> : null}
                        </span>
                        <span className="ob-beads">
                          {people.slice(0, BEAD_CAP).map((x) => <Bead key={x.id} p={x} />)}
                          {people.length > BEAD_CAP ? <span className="ob-beads__more">+{n(people.length - BEAD_CAP)}</span> : null}
                        </span>
                      </button>
                    </span>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {ABSENCES.map((why) => {
        const list = g.roles.filter((r) => r.absence === why);
        if (!list.length) return null;
        const open = openAbs[why] || list.length <= CHIP_CAP;
        return (
          <div key={why} className="ob-abs">
            <div className="ob-abs__h">
              <OrbitMark kind={why} />
              <h3>{t(`abs.${why}.title`)}</h3>
              <span>{t(`abs.${why}.long`, { count: list.length })}</span>
              {list.length > CHIP_CAP ? (
                <Button
                  label={open ? t("showFewer") : t("showAll", { count: list.length })}
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpenAbs((o) => ({ ...o, [why]: !o[why] }))}
                />
              ) : null}
            </div>
            <div className="ob-abs__list">
              {(open ? list : list.slice(0, CHIP_CAP)).map((r) => {
                const chipCls = cx("ob-chip", `ob-chip--${why}`, selRole === r.key && "is-on");
                return (
                  <button key={r.key} type="button" className={chipCls} onClick={() => onRole(r.key)}>
                    <span>{r.title}</span>
                    <small>{r.city ?? r.job?.location ?? ""}</small>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="ob-lanes__foot">
        <Button label={t("editSla")} variant="link" size="sm" onClick={onEditSla} />
      </div>
    </div>
  );
}

export function statusWord(words: OrbitWords, r: Pick<OrbitRole, "status">): string {
  return r.status === "draft" ? words.t("status.draft") : r.status === "closed" ? words.t("status.closed") : r.status === "published" ? words.t("status.published") : words.t("status.open");
}
