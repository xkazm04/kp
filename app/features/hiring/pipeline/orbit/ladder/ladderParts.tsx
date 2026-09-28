"use client";

import type { ReactNode } from "react";
import { Segmented } from "@/app/_components/kit";
import type { PipelineEvent, StageDef } from "@/app/features/shared/pipelineTypes";
import { ladderPeople, type LadderRung, type OrbitPerson, type OrbitRole } from "../orbitModel";
import { Bead, OrbitMark } from "../OrbitMarks";
import { roleMark, statusWord } from "../OrbitLanes";
import { cx } from "../orbitCx";
import type { OrbitWords } from "../orbitWords";

/** The person row's open control (painted by pipelineOrbit.css). */
const PP_OPEN = "ob-pp__open";

/** Everything the role bench reads. */
export type LadderProps = {
  role: OrbitRole;
  groupLabel: string;
  axis: readonly StageDef[];
  words: OrbitWords;
  /** Each column's aging cadence in days (0 = never ages), in axis order. */
  sla: readonly number[];
  /** The rung in focus (a stage cell was clicked), or null for the whole ladder (the title was). */
  stage: string | null;
  rungs: LadderRung[];
  onStage: (stage: string | null) => void;
  /** Open the candidate record, with the ladder's reading order as prev/next. */
  onPerson: (p: OrbitPerson, cohort: readonly OrbitPerson[]) => void;
  onClose: () => void;
  /** Step to the previous / next role of the group. */
  onStep: (delta: 1 | -1) => void;
  index: number;
  total: number;
  highlight: string | null;
  lastEvent: (entryId: string) => PipelineEvent | null;
  eventWord: (ev: PipelineEvent) => string;
  ago: (iso: string) => string;
  /** The compare selection (entry ids), shared across variants so a pick survives a switch. */
  picked: readonly string[];
  onPick: (ids: string[]) => void;
  now: number;
  /** The channel an entry came through, in words, or null when none was recorded. */
  source: (p: OrbitPerson) => string | null;
  date: (iso: string) => string;
};

/** Whole days on the current stage (since the last recorded move, else since the candidate was added). */
export function daysOn(p: OrbitPerson, now: number): number | null {
  const at = p.entry.stageChangedAt ?? p.entry.createdAt;
  const ms = at ? Date.parse(at) : NaN;
  return Number.isFinite(ms) ? Math.max(0, Math.floor((now - ms) / 86_400_000)) : null;
}

export function scoreTone(v: number | null): "strong" | "mid" | "weak" | "null" {
  return v == null ? "null" : v >= 75 ? "strong" : v >= 50 ? "mid" : "weak";
}

/** A score, or a dashed "—" that says it was never scored (never a zero). */
export function ScoreChip({ value, words, big = false }: { value: number | null; words: OrbitWords; big?: boolean }) {
  return (
    <span className={cx("ob-score", `ob-score--${scoreTone(value)}`, big && "is-big")} aria-label={value == null ? words.t("neverScored") : words.t("scoreAria", { score: value })}>
      {value == null ? "—" : words.n(value)}
    </span>
  );
}

/** "12d / 7d" against the stage's cadence; amber once over it. */
export function AgeText({ p, sla, now, words }: { p: OrbitPerson; sla: number; now: number; words: OrbitWords }) {
  const d = daysOn(p, now);
  if (d == null) return <span className="ob-age">—</span>;
  return (
    <span className={cx("ob-age", p.aging && "ob-late")}>
      {sla ? words.t("daysOfSla", { days: d, sla }) : words.t("daysN", { count: d })}
    </span>
  );
}

/** The role's head: title, where and who, four figures, what the waiting people wait for, and the rung filter. */
export function LadderFacts({ l, children, titleId }: { l: LadderProps; children?: ReactNode; titleId?: string }) {
  const { role: r, words, axis } = l;
  const { t, n } = words;
  const meta = [r.city ?? r.job?.location, r.seniority ? words.enumLabel("seniority", r.seniority) : null, statusWord(words, r)].filter(Boolean).join(" · ");
  const kinds = Object.entries(r.waitKinds).sort((a, b) => b[1] - a[1]);
  return (
    <div className="ob-lf">
      <h3 className="ob-lf__title" id={titleId} tabIndex={-1} data-role="orbit-ladder-title">
        <OrbitMark kind={roleMark(r)} />
        {r.title}
      </h3>
      <p className="ob-lf__meta">{meta}</p>
      {children}
      <div className="ob-lf__figs">
        <div><span>{t("figActive")}</span><b>{n(r.act)}</b></div>
        <div className={cx(r.wait > 0 && "is-needs")}><span>{t("figWaiting")}</span><b>{n(r.wait)}</b></div>
        <div><span>{t("figLate")}</span><b>{n(r.aging)}</b></div>
        <div><span>{t("figHired")}</span><b>{n(r.hired)}{r.target != null ? <small> / {n(r.target)}</small> : null}</b></div>
      </div>
      {kinds.length ? (
        <p className="ob-lf__kinds">
          {kinds.map(([k, c]) => (
            <span key={k}><span className="ob-w"><OrbitMark kind="needs" small />{n(c)}</span> {words.kind(k)}</span>
          ))}
        </p>
      ) : null}
      {r.act === 0 ? <p className="ob-note">{t(`abs.${r.absence ?? "vacant"}.why`)}</p> : null}
      {r.act > 0 ? (
        <div className="ob-lf__rungs">
          <Segmented
            label={t("rungFilter")}
            value={l.stage ?? ""}
            onChange={(v) => l.onStage(v || null)}
            items={[{ value: "", label: t("allStages"), count: r.act }, ...axis.map((s, i) => ({ value: s.id, label: words.stage(s.id), count: r.st[i].n }))]}
          />
        </div>
      ) : null}
    </div>
  );
}

/** One person, as a row: the bead, name and what they wait for, the score, days on the stage. */
export function PersonRow({ p, l, sla, cohort, pick }: { p: OrbitPerson; l: LadderProps; sla: number; cohort: readonly OrbitPerson[]; pick?: boolean }) {
  const { words } = l;
  const picked = l.picked.includes(p.id);
  const rowCls = cx("ob-pp", l.highlight === p.id && "is-hit", picked && "is-picked");
  return (
    <li className={rowCls} data-person={p.id}>
      {pick ? (
        <input
          type="checkbox"
          className="ob-pp__pick"
          checked={picked}
          onChange={() => l.onPick(picked ? l.picked.filter((x) => x !== p.id) : [...l.picked, p.id])}
          aria-label={words.t("pickAria", { name: p.name })}
        />
      ) : null}
      <button type="button" className={PP_OPEN} onClick={() => l.onPerson(p, cohort)} aria-label={words.t("openPersonAria", { name: p.name })}>
        <Bead p={p} as="span" />
        <span className="ob-pp__nm">
          <b>{p.name}</b>
          {p.waiting ? <small className="ob-w"><OrbitMark kind="needs" small />{words.kind(p.waiting)}</small> : null}
        </span>
        <ScoreChip value={p.score} words={words} />
        <AgeText p={p} sla={sla} now={l.now} words={words} />
      </button>
    </li>
  );
}

/** The ladder as rungs of rows: the side pane's body and the compare bench's picker. */
export function LadderRungs({ l, pick = false }: { l: LadderProps; pick?: boolean }) {
  const { words } = l;
  const cohort = ladderPeople(l.rungs);
  return (
    <div className="ob-rungs">
      {l.rungs.map((rung) => (
        <section key={rung.stage.id} className="ob-rung" aria-label={words.stage(rung.stage.id)}>
          <h4>
            {words.stage(rung.stage.id)}
            <small>{words.n(rung.people.length)}{l.sla[rung.si] ? ` · ${words.t("slaDays", { count: l.sla[rung.si] })}` : ""}</small>
            {l.role.st[rung.si].wait ? <small className="ob-w"><OrbitMark kind="needs" small />{words.t("waitingN", { count: l.role.st[rung.si].wait })}</small> : null}
          </h4>
          {rung.people.length ? (
            <ol>{rung.people.map((p) => <PersonRow key={p.id} p={p} l={l} sla={l.sla[rung.si]} cohort={cohort} pick={pick} />)}</ol>
          ) : (
            <p className="ob-rung__zero">{words.t("nobodyIn", { stage: words.stage(rung.stage.id) })}</p>
          )}
        </section>
      ))}
      <p className="ob-note">{words.t("ladderOrderNote")}</p>
    </div>
  );
}

