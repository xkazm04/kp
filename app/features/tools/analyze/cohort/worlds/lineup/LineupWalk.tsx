"use client";

import { useId } from "react";
import { KeyHints, ScenePress } from "@/app/_components/kit/scene";
import type { CohortView } from "../../cohortTypes";
import type { LineupWords } from "./useLineupWords";

const STOP = "lu-walk__stop";
const KEYS_STREET = [
  { id: "move", keys: ["tab", "arrows"], act: "move" },
  { id: "open", keys: ["enter"], act: "open" },
] as const;

/**
 * The walk-through under the street: the model's (or the fallback's) narrative over the strongest few by
 * fit, which says whom it covers (the numbered rings on the street, each a stop you can press to stand
 * in front of that building) and how many it leaves out, and who wrote it. While the cohort runs, or
 * when too few are rated, it says why there is none. Then the keys the street answers to.
 */
export function LineupWalk({ view, words, onStop }: { view: CohortView; words: LineupWords; onStop: (memberId: string) => void }) {
  const { t } = words;
  const nar = view.narrative;
  const running = view.status === "running" || view.status === "queued";
  const titleId = useId();
  return (
    <section className="lu-walk" aria-labelledby={titleId}>
      <div className="lu-walk__head">
        <h3 id={titleId} className="lu-walk__title">
          {t("walk.title")}
        </h3>
        {nar ? <p className="lu-walk__covers">{t("walk.covers", { covers: nar.covers.length, leftOut: nar.leavesOut })}</p> : null}
      </div>
      {nar ? (
        <>
          <ol className="lu-walk__stops">
            {nar.covers.map((id, i) => (
              <li key={id}>
                <ScenePress className={STOP} aria-label={`${t("stop", { n: i + 1 })}: ${words.nameOf(id)}`} onClick={() => onStop(id)}>
                  <span className="lu-stop" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span>{words.nameOf(id)}</span>
                </ScenePress>
              </li>
            ))}
          </ol>
          <p className="lu-walk__text">{nar.text}</p>
          <p className="lu-walk__engine">{t(nar.engine === "model" ? "walk.model" : "walk.keyless")}</p>
        </>
      ) : (
        <p className="lu-walk__text">{t(running ? "walk.pending" : "walk.none")}</p>
      )}
      <KeyHints
        label={t("keys.label")}
        hints={KEYS_STREET.map((h) => ({ id: h.id, keys: h.keys.map((k) => t(`keys.names.${k}`)), act: t(`keys.acts.${h.act}`) }))}
      />
    </section>
  );
}
