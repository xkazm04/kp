"use client";

import type { KeyboardEvent } from "react";
import { ScenePress } from "@/app/_components/kit/scene";
import type { CohortDimension } from "../../cohortTypes";
import { LoomKnot } from "./LoomKnot";
import { bindingOf, knotOf, type RowReading, type Thread } from "./loomModel";
import type { LoomWords } from "./useLoomWords";

/**
 * The pulled row: the weft taken out of the loom, laid straight across the top of its page with every
 * thread's knot still on it, in the order the loom hangs them. A knot press follows that member through
 * the page below (the DimensionPage's focus). ← → walk the knots (one roving stop), Enter follows.
 * `ghost` renders the same row as the drawing that travels during the pull (inert, unlabelled).
 */
export function LoomRail({ dimension, reading, threads, words, follow, onFollow, ghost = false }: {
  dimension: CohortDimension;
  reading: RowReading;
  threads: readonly Thread[];
  words: LoomWords;
  follow: string | null;
  onFollow?: (memberId: string | null) => void;
  ghost?: boolean;
}) {
  const { t } = words;
  const at = Math.max(0, threads.findIndex((th) => th.member.memberId === follow));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    const keys = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-rail-key]")];
    const i = keys.indexOf(e.target as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const next = e.key === "Home" ? 0 : e.key === "End" ? keys.length - 1 : Math.max(0, Math.min(keys.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)));
    keys[next]?.focus();
  };
  const knots = threads.map((th, i) => {
    const knot = <LoomKnot knot={knotOf(th.member.cells[dimension])} bind={bindingOf(reading, th.member.memberId)} />;
    if (ghost) return <span key={th.member.memberId} className="lm-rail__slot">{knot}</span>;
    const on = th.member.memberId === follow;
    return (
      <span key={th.member.memberId} className="lm-rail__slot" data-follow={on || undefined} data-state={th.state}>
        <ScenePress
          className="lm-rail__knot"
          data-rail-key={th.member.memberId}
          aria-pressed={on}
          aria-label={words.knotName(th.member, dimension)}
          tabIndex={i === at ? 0 : -1}
          onClick={() => onFollow?.(on ? null : th.member.memberId)}
        >
          {knot}
        </ScenePress>
        {on ? <span className="lm-rail__who">{th.member.label}</span> : null}
      </span>
    );
  });
  if (ghost) {
    return (
      <div className="lm-rail lm-rail--ghost" aria-hidden style={{ gridTemplateColumns: `repeat(${threads.length}, minmax(0, 1fr))` }}>
        {knots}
      </div>
    );
  }
  return (
    <div className="lm-rail-wrap">
      <p className="lm-rail__caption">
        <span>{t("level.rail", { dim: words.dim(dimension) })}</span>
        <span className="lm-rail__following">{follow ? t("level.following", { name: words.name(follow) }) : t("level.followNone")}</span>
      </p>
      <div
        className="lm-rail"
        role="toolbar"
        aria-label={t("level.rail", { dim: words.dim(dimension) })}
        data-loom-rail=""
        onKeyDown={onKeyDown}
        style={{ gridTemplateColumns: `repeat(${threads.length}, minmax(0, 1fr))` }}
      >
        {knots}
      </div>
    </div>
  );
}
