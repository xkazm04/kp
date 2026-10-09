"use client";

import { Button } from "@/app/_components/kit";
import { KeyHints, LevelFrame, LevelTrail, ScenePress, type Crumb, type LevelTone } from "@/app/_components/kit/scene";
import type { CohortDimension, CohortMember, CohortView } from "../../cohortTypes";
import { DimensionPage } from "../../dimensions/DimensionPage";
import { LineupCorridorStrip } from "./LineupCorridorStrip";
import { STREET_ROWS, floorClaimOf, stepDimension } from "./lineupModel";
import type { LineupWords } from "./useLineupWords";

/** Each floor has its own ground, so taking the stairs reads as arriving somewhere else. */
const GROUND: Record<CohortDimension, LevelTone> = {
  fit: "steel",
  skills: "moss",
  experience: "stone",
  signals: "amber",
  trust: "steel",
  salary: "stone",
  publicWork: "moss",
};
const LIFT = "lu-lift__floor";
const KEYS_FLOOR = [
  { id: "floors", keys: ["brackets", "leftRight"], act: "floors" },
  { id: "back", keys: ["esc"], act: "back" },
] as const;

/**
 * Level 1: one floor walked across every building. The kit's level frame (trail back to the street, the
 * dimension as the heading, the floor's claim as the kicker and the lead), then this world's own furniture:
 * the lift's floor indicator (the stairs, one press per floor, plus up / down) and the corridor strip (the
 * floor itself, a door per building), and under them the shared dimension page, focused on the door
 * the reader follows.
 */
export function LineupFloorLevel({ view, street, dimension, focus, words, crumbs, onBack, onFloor, onFocusMember, onOpenReport }: {
  view: CohortView;
  street: readonly CohortMember[];
  dimension: CohortDimension;
  focus: string | null;
  words: LineupWords;
  crumbs: readonly Crumb[];
  onBack: () => void;
  onFloor: (d: CohortDimension) => void;
  onFocusMember: (memberId: string | null) => void;
  onOpenReport: (slug: string) => void;
}) {
  const { t } = words;
  const claim = floorClaimOf(view, dimension);
  const note = view.claims.byDimension[dimension].note;
  const lead =
    claim.tone === "clears"
      ? t("level.lead.clears", { name: words.nameOf(claim.leader) })
      : claim.tone === "partitioned"
        ? t("level.lead.partitioned", { count: claim.partitions })
        : dimension === "salary" && claim.tone === "insideNoise"
          ? t("level.lead.salary")
          : t(`level.lead.${claim.tone}`);
  return (
    <LevelFrame
      tone={GROUND[dimension]}
      kicker={t("level.kicker", { rated: claim.rated, total: view.members.length, claim: words.claimShort(dimension) })}
      title={words.dim(dimension)}
      lead={lead}
      trail={<LevelTrail crumbs={crumbs} onBack={onBack} backLabel={t("level.back")} label={t("level.crumbs")} />}
      keys={
        <KeyHints label={t("keys.label")} hints={KEYS_FLOOR.map((h) => ({ id: h.id, keys: h.keys.map((k) => t(`keys.names.${k}`)), act: t(`keys.acts.${h.act}`) }))} />
      }
    >
      <div className="lu-floorlvl" data-claim={claim.tone}>
        <nav className="lu-lift" aria-label={t("level.indicator")}>
          <Button label={t("level.up")} icon="up" size="sm" iconOnly data-level-key="stairs-up" onClick={() => onFloor(stepDimension(dimension, -1))} />
          <ol className="lu-lift__floors">
            {STREET_ROWS.map((d) => (
              <li key={d}>
                <ScenePress className={LIFT} data-level-key={`floor-${d}`} aria-current={d === dimension ? "true" : undefined} onClick={() => onFloor(d)}>
                  <span className="lu-lift__lamp" aria-hidden="true" />
                  {words.dim(d)}
                </ScenePress>
              </li>
            ))}
          </ol>
          <Button label={t("level.down")} icon="down" size="sm" iconOnly data-level-key="stairs-down" onClick={() => onFloor(stepDimension(dimension, 1))} />
        </nav>
        <LineupCorridorStrip view={view} street={street} dimension={dimension} focus={focus} words={words} onFocusMember={onFocusMember} />
        {note ? (
          <p className="lu-floorlvl__note">
            <span>{t("level.note")}</span> {note}
          </p>
        ) : null}
        <DimensionPage view={view} dimension={dimension} focusMemberId={focus} onFocusMember={onFocusMember} onOpenReport={onOpenReport} />
      </div>
    </LevelFrame>
  );
}
