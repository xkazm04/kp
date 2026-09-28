"use client";

import { useEffect, useEffectEvent, type ReactNode } from "react";
import { Button } from "@/app/_components/kit";
import { ladderPeople, type OrbitPerson } from "../orbitModel";
import { Bead, OrbitMark } from "../OrbitMarks";
import { cx } from "../orbitCx";
import { daysOn, LadderFacts, LadderRungs, ScoreChip, type LadderProps } from "./ladderParts";

/** More columns than this stop being a comparison and become a list. */
export const COMPARE_MAX = 4;

/**
 * Variant "Compare": the role as a bench. The ladder on the left is a picker (a checkbox per person);
 * the right side lines the picked people up column by column on the facts a decision turns on, and
 * marks the best score and the longest wait. It opens on two SIBLINGS (the top two of the clicked
 * stage, else of the first stage with anyone on it), and each column steps to its neighbour on the
 * same stage, so "this one or the next one?" is one click.
 */
export function OrbitLadderCompare(l: LadderProps) {
  const { role: r, words } = l;
  const { t, n } = words;
  const cohort = ladderPeople(l.rungs);
  const mine = l.picked.map((id) => r.people.find((p) => p.id === id)).filter((p): p is OrbitPerson => p != null).slice(0, COMPARE_MAX);
  const siblings = (): string[] => {
    const rung = l.rungs.find((x) => x.people.length >= 1 && (l.stage == null || x.stage.id === l.stage));
    return rung ? rung.people.slice(0, 2).map((p) => p.id) : [];
  };

  // A fresh bench (nobody of this role picked yet) opens on two siblings.
  const openOnSiblings = useEffectEvent(() => {
    if (mine.length === 0 && r.act > 0) l.onPick(siblings());
  });
  useEffect(() => openOnSiblings(), [r.key, l.stage]);

  const bestScore = Math.max(...mine.map((p) => p.score ?? -1));
  const longest = Math.max(...mine.map((p) => daysOn(p, l.now) ?? -1));
  const neighbour = (p: OrbitPerson, d: 1 | -1): OrbitPerson | null => {
    const rung = l.rungs.find((x) => x.si === p.si) ?? { people: r.people.filter((x) => x.si === p.si) };
    const i = rung.people.findIndex((x) => x.id === p.id);
    return rung.people[i + d] ?? null;
  };
  const swap = (p: OrbitPerson, q: OrbitPerson) => l.onPick(l.picked.map((id) => (id === p.id ? q.id : id)).filter((id, i, a) => a.indexOf(id) === i));

  const rows: { label: string; cell: (p: OrbitPerson) => ReactNode }[] = [
    { label: t("cmpStage"), cell: (p) => words.stage(l.axis[p.si].id) },
    {
      label: t("cmpScore"),
      cell: (p) => (
        <span className={cx("ob-cmp__score", p.score != null && p.score === bestScore && mine.length > 1 && "is-best")}>
          <ScoreChip value={p.score} words={words} big />
          {p.score != null ? <i className="ob-cmp__bar" aria-hidden><i style={{ width: `${p.score}%` }} /></i> : <small>{t("neverScored")}</small>}
        </span>
      ),
    },
    {
      label: t("cmpOnStage"),
      cell: (p) => {
        const d = daysOn(p, l.now);
        const sla = l.sla[p.si];
        return (
          <span className={cx(p.aging && "ob-late", d != null && d === longest && mine.length > 1 && "ob-longest")}>
            {d == null ? "—" : sla ? t("daysOfSla", { days: d, sla }) : t("daysN", { count: d })}
          </span>
        );
      },
    },
    { label: t("cmpWaiting"), cell: (p) => (p.waiting ? <span className="ob-w"><OrbitMark kind="needs" small />{words.kind(p.waiting)}</span> : t("cmpNotWaiting")) },
    { label: t("cmpHow"), cell: (p) => (p.walked ? t("walked") : t("placed")) },
    { label: t("cmpSource"), cell: (p) => l.source(p) ?? t("sourceNone") },
    { label: t("cmpArchetype"), cell: (p) => (p.entry.archetype ? words.enumLabel("archetype", p.entry.archetype) : "—") },
    { label: t("cmpAdded"), cell: (p) => (p.entry.createdAt ? l.date(p.entry.createdAt) : "—") },
    {
      label: t("cmpLast"),
      cell: (p) => {
        const ev = l.lastEvent(p.id);
        return ev ? `${l.eventWord(ev)} · ${l.ago(ev.createdAt)}` : t("noEvent");
      },
    },
  ];

  return (
    <div className="ob-bench" data-role="orbit-ladder" data-variant="compare">
      <div className="ob-page__top">
        <Button label={t("backToLanes", { group: l.groupLabel })} icon="left" variant="ghost" size="sm" onClick={l.onClose} tip={t("backTip")} />
        <span className="ob-lnav__pos">{t("position", { index: n(l.index + 1), total: n(l.total) })}</span>
        <Button label={t("prevRole")} icon="up" iconOnly size="sm" variant="ghost" disabled={l.total < 2} onClick={() => l.onStep(-1)} />
        <Button label={t("nextRole")} icon="down" iconOnly size="sm" variant="ghost" disabled={l.total < 2} onClick={() => l.onStep(1)} />
      </div>
      <div className="ob-bench__grid">
        <div className="ob-bench__pick">
          <LadderFacts l={l} titleId="ob-ladder-title" />
          {r.act ? <LadderRungs l={l} pick /> : null}
        </div>
        <section className="ob-bench__cmp" aria-label={t("cmpTitle")}>
          <div className="ob-bench__acts">
            <h3>{t("cmpTitle")} <small>{t("cmpCount", { count: mine.length, max: COMPARE_MAX })}</small></h3>
            <Button label={t("cmpSiblings")} variant="secondary" size="sm" onClick={() => l.onPick(siblings())} disabled={r.act === 0} />
            <Button label={t("cmpClear")} variant="ghost" size="sm" onClick={() => l.onPick([])} disabled={!mine.length} />
          </div>
          {l.picked.length > COMPARE_MAX ? <p className="ob-note">{t("cmpTooMany", { max: COMPARE_MAX })}</p> : null}
          {mine.length < 2 ? (
            <p className="ob-bench__empty">{t("cmpEmpty")}</p>
          ) : (
            <div className="ob-cmp" role="table" aria-label={t("cmpTitle")} style={{ ["--ob-cmp" as string]: mine.length }}>
              <div className="ob-cmp__row ob-cmp__row--head" role="row">
                <span role="columnheader" />
                {mine.map((p) => {
                  const prev = neighbour(p, -1);
                  const next = neighbour(p, 1);
                  return (
                    <span key={p.id} role="columnheader" className="ob-cmp__who">
                      <span className="ob-cmp__name"><Bead p={p} as="span" /><b>{p.name}</b></span>
                      <span className="ob-cmp__acts">
                        <Button label={t("cmpPrevSibling")} icon="left" iconOnly size="sm" variant="ghost" disabled={!prev} onClick={() => prev && swap(p, prev)} />
                        <Button label={t("cmpNextSibling")} icon="right" iconOnly size="sm" variant="ghost" disabled={!next} onClick={() => next && swap(p, next)} />
                        <Button label={t("cmpOpen", { name: p.name })} icon="open" iconOnly size="sm" variant="ghost" onClick={() => l.onPerson(p, cohort)} />
                        <Button label={t("cmpRemove", { name: p.name })} icon="x" iconOnly size="sm" variant="ghost" onClick={() => l.onPick(l.picked.filter((id) => id !== p.id))} />
                      </span>
                    </span>
                  );
                })}
              </div>
              {rows.map((row) => (
                <div key={row.label} className="ob-cmp__row" role="row">
                  <span role="rowheader">{row.label}</span>
                  {mine.map((p) => <span key={p.id} role="cell">{row.cell(p)}</span>)}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
