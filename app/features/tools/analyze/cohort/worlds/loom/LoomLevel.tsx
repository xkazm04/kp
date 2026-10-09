"use client";

import { KeyHints, LevelFrame, LevelTrail, ScenePress, type Crumb } from "@/app/_components/kit/scene";
import { Button } from "@/app/_components/kit";
import { COHORT_DIMENSIONS, type CohortDimension, type CohortView } from "../../cohortTypes";
import { DimensionPage } from "../../dimensions/DimensionPage";
import { LoomRail } from "./LoomRail";
import type { RowReading, Thread } from "./loomModel";
import type { LoomWords } from "./useLoomWords";

const KEY_HINTS = [
  { id: "step", keys: ["brackets", "leftRight"], act: "step" },
  { id: "follow", keys: ["enter"], act: "follow" },
  { id: "back", keys: ["esc"], act: "back" },
] as const;

/**
 * Level 1: one weft row pulled out of the loom. The kit's LevelFrame (trail back to the loom, the
 * dimension as the heading, the row's claim in the kicker, its note as the lead), the pulled row laid
 * across the top (LoomRail: every thread's knot, a press follows that member), then the shared
 * DimensionPage. The foot is the loom's seven spools: the sideways step, also on [ ] and ← →.
 */
export function LoomLevel({ view, dimension, reading, rated, note, threads, words, follow, onFollow, settled, crumbs, onBack, onStep, onGo, onOpenReport }: {
  view: CohortView;
  dimension: CohortDimension;
  reading: RowReading;
  rated: number;
  note: string | null;
  threads: readonly Thread[];
  words: LoomWords;
  follow: string | null;
  onFollow: (memberId: string | null) => void;
  /** The pull has finished: only then is the followed member handed to the page (it scrolls to them). */
  settled: boolean;
  crumbs: readonly Crumb[];
  onBack: () => void;
  onStep: (delta: 1 | -1) => void;
  onGo: (d: CohortDimension) => void;
  onOpenReport: (slug: string) => void;
}) {
  const { t } = words;
  const parent = crumbs[crumbs.length - 2];
  return (
    <LevelFrame
      tone={reading.kind === "clears" ? "moss" : reading.kind === "insideNoise" ? "amber" : "stone"}
      kicker={t(`level.kicker.${reading.kind}`, { rated, total: view.members.length })}
      title={words.dim(dimension)}
      lead={note ?? undefined}
      trail={<LevelTrail crumbs={crumbs} onBack={onBack} backLabel={t("level.back", { place: parent?.label ?? "" })} label={t("level.crumbs")} />}
      foot={
        <nav className="lm-steps" aria-label={t("level.rows")}>
          <Button label={t("level.prev")} icon="left" iconOnly size="sm" data-level-key="step-prev" onClick={() => onStep(-1)} />
          <ol>
            {COHORT_DIMENSIONS.map((d) => (
              <li key={d}>
                <ScenePress className="lm-steps__spool" aria-current={d === dimension ? "page" : undefined} data-level-key={`go-${d}`} onClick={() => onGo(d)}>
                  {words.dim(d)}
                </ScenePress>
              </li>
            ))}
          </ol>
          <Button label={t("level.next")} icon="right" iconOnly size="sm" data-level-key="step-next" onClick={() => onStep(1)} />
        </nav>
      }
      keys={
        <KeyHints
          label={t("keys.label")}
          hints={KEY_HINTS.map((h) => ({ id: h.id, keys: h.keys.map((k) => t(`keys.names.${k}`)), act: t(`keys.acts.${h.act}`) }))}
        />
      }
    >
      <LoomRail dimension={dimension} reading={reading} threads={threads} words={words} follow={follow} onFollow={onFollow} />
      <div className="lm-page">
        <DimensionPage view={view} dimension={dimension} focusMemberId={settled ? follow : null} onFocusMember={onFollow} onOpenReport={onOpenReport} />
      </div>
    </LevelFrame>
  );
}
