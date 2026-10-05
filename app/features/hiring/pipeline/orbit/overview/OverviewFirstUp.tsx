"use client";

import { useTranslations } from "next-intl";
import { ScenePress } from "@/app/_components/kit/scene";
import type { StageDef } from "@/app/features/shared/pipelineTypes";
import type { OrbitPerson } from "../orbitModel";
import { OrbitMark } from "../OrbitMarks";
import { cx } from "../orbitCx";
import type { OrbitWords } from "../orbitWords";
import type { FirstUp, LitVia } from "./overviewModel";

type Props = {
  first: FirstUp;
  axis: readonly StageDef[];
  words: OrbitWords;
  onHot: (on: boolean, via: LitVia) => void;
  onPerson: (p: OrbitPerson) => void;
};

/**
 * "First up": the one person to start with, under "needs you, start here". Of the people waiting on
 * a human who have a stage clock, the one furthest over their stage's SLA (or nearest it when nobody
 * is over). When nobody waits, or nobody waiting has a clock yet, it says so instead of picking.
 */
export function OverviewFirstUp({ first, axis, words, onHot, onPerson }: Props) {
  const tl = useTranslations("overviewLit.firstUp");
  if (first.state !== "ok") {
    return (
      <article className="ov-first is-quiet" aria-label={tl("eyebrow")}>
        <p className="ov-first__eyebrow">{tl("eyebrow")}</p>
        <p className="ov-first__line">{first.state === "none" ? tl("none") : tl("noClock", { count: first.waiting })}</p>
      </article>
    );
  }
  const p = first.person;
  const stage = words.stage(axis[p.si]?.id ?? "");
  const cls = cx("ov-first", first.over && "is-over");
  return (
    <article
      className={cls}
      aria-label={tl("eyebrow")}
      onPointerEnter={() => onHot(true, "pointer")}
      onPointerLeave={() => onHot(false, "pointer")}
      onFocus={() => onHot(true, "focus")}
      onBlur={(e) => { if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) onHot(false, "focus"); }}
      data-role="overview-first-up"
    >
      <p className="ov-first__eyebrow">
        <OrbitMark kind={first.over ? "late" : "needs"} small />
        {tl("eyebrow")}
      </p>
      <ScenePress className="ov-first__name" onClick={() => onPerson(p)}>{p.name}</ScenePress>
      <p className="ov-first__line">{p.role.title}</p>
      <p className="ov-first__line">{p.waiting ? tl("waitingOn", { kind: words.kind(p.waiting), stage }) : stage}</p>
      <p className="ov-first__line">
        <b className={cx(first.over && "ob-a")}>
          {first.over ? tl("overLine", { over: Math.max(0, first.days - first.sla), sla: first.sla }) : tl("insideLine", { days: first.days, sla: first.sla })}
        </b>
      </p>
    </article>
  );
}
