"use client";

import { useId } from "react";
import { ScenePress } from "@/app/_components/kit/scene";
import type { CohortView } from "../../cohortTypes";
import type { Thread } from "./loomModel";
import type { LoomWords } from "./useLoomWords";

/**
 * The cloth under the loom: the comparative narrative, woven only from the threads it discusses (they
 * continue into the cloth band of the drawing; the others end in a tassel). It names who it covers, in
 * its own order, and says how many it leaves out and that their cells stand on their own. Before the
 * run finishes there is no cloth, and it says why. A covered name lights its thread; a press finds it.
 */
export function LoomCloth({ view, threads, words, onRead }: {
  view: CohortView;
  threads: readonly Thread[];
  words: LoomWords;
  onRead: (col: number | null) => void;
}) {
  const { t } = words;
  const titleId = useId();
  const n = view.narrative;
  if (!n) {
    return (
      <section className="lm-cloth-card" data-empty="">
        <p className="lm-cloth-card__empty">{view.status === "done" ? t("cloth.none") : t("cloth.pending")}</p>
      </section>
    );
  }
  const colOf = new Map(threads.map((th) => [th.member.memberId, th.col]));
  return (
    <section className="lm-cloth-card" aria-labelledby={titleId}>
      <div className="lm-cloth-card__head">
        <h3 id={titleId} className="lm-cloth-card__title">
          {t("cloth.title", { n: n.covers.length })}
        </h3>
        <ol className="lm-cloth-card__covers">
          {n.covers.map((id) => (
            <li key={id}>
              <ScenePress
                className="lm-cloth-card__who"
                onPointerEnter={() => onRead(colOf.get(id) ?? null)}
                onPointerLeave={() => onRead(null)}
                onFocus={() => onRead(colOf.get(id) ?? null)}
                onBlur={() => onRead(null)}
                onClick={(e) => e.currentTarget.closest(".lm-loom")?.querySelector<HTMLElement>(`[data-loom-key="tag:${colOf.get(id)}"]`)?.focus()}
              >
                {words.name(id)}
              </ScenePress>
            </li>
          ))}
        </ol>
      </div>
      <p className="lm-cloth-card__text">{n.text}</p>
      <p className="lm-cloth-card__foot">
        <span>{t("cloth.leavesOut", { n: n.leavesOut })}</span>
        <span>{n.engine === "model" ? t("cloth.model") : t("cloth.keyless")}</span>
      </p>
    </section>
  );
}
