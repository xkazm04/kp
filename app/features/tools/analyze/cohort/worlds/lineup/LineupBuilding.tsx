"use client";

import type { CSSProperties, MouseEvent } from "react";
import { ABSENT } from "@/app/_components/kit";
import { ScenePress } from "@/app/_components/kit/scene";
import type { CohortDimension, CohortMember } from "../../cohortTypes";
import { CrownGlyph, LeadGlyph, PennantGlyph, ReasonGlyph } from "./art/LineupGlyphs";
import { SIGN_ROW, cellKey, type GridCell } from "./lineupGrid";
import { FLOORS, cellBand, litShare, lotOf } from "./lineupModel";
import type { LineupWords } from "./useLineupWords";

export type BuildingProps = {
  m: CohortMember;
  /** 0-based place on the street (the grid column is col + 1: column 0 is the directory). */
  col: number;
  words: LineupWords;
  active: GridCell;
  on: boolean;
  crown: boolean;
  haze: boolean;
  leads: ReadonlySet<CohortDimension>;
  stop: number | null;
  walking: CohortDimension | null;
  onLook: (at: GridCell, via: "focus" | "pointer" | "leave") => void;
  onWalk: (d: CohortDimension, el: HTMLElement, memberId: string) => void;
  onOpenReport: (slug: string) => void;
  setRef: (memberId: string, el: HTMLDivElement | null) => void;
};

const TOWER = "lu-tower";
const FLOOR = "lu-floor";
const SIGN = "lu-sign";
/** How high an unbuilt lot's outline stands (percent of the tower row), matching `.lu-tower__lot`. */
const LOT_SHARE = 24;

/**
 * One candidate as a building: the tower is fit (its height the rating, the bracket its band, a crown only
 * when the overall lead clears, haze when it stands inside the noise), the six floors are the other
 * dimensions (lit windows = the rating; boarded with its reason when absent; scaffolding while it is
 * analyzed), the house number is the fit rank (shared ranks say so), the sign on the pavement opens the
 * full report. Every part is a roving cell of the street's one tab stop.
 */
export function LineupBuilding(p: BuildingProps) {
  const { m, col, words, active } = p;
  const gcol = col + 1;
  const press = (row: number) => ({
    "data-lu-cell": cellKey({ row, col: gcol }),
    tabIndex: active.row === row && active.col === gcol ? 0 : -1,
    onFocus: () => p.onLook({ row, col: gcol }, "focus"),
    onPointerEnter: () => p.onLook({ row, col: gcol }, "pointer"),
    onPointerLeave: () => p.onLook({ row, col: gcol }, "leave"),
  });
  const walk = (d: CohortDimension) => (e: MouseEvent<HTMLButtonElement>) => p.onWalk(d, e.currentTarget, m.memberId);
  const walkMark = (d: CohortDimension) => (p.walking === d ? "" : undefined);

  const fit = m.cells.fit;
  const fitLot = lotOf(fit);
  const band = cellBand(fit);
  // An unbuilt lot is drawn a fixed quarter high (LOT_SHARE in lineup.css), never at a height that reads as a rating.
  const towerStyle = { "--fit": fit.rating ?? 0, "--top": fit.rating ?? LOT_SHARE, "--lo": band?.lo ?? 0, "--hi": band?.hi ?? 0 } as CSSProperties;

  return (
    <div
      ref={(el) => p.setRef(m.memberId, el)}
      role="group"
      aria-label={words.t("building", { name: m.label, rank: words.rank(m) })}
      className="lu-b"
      style={{ "--col": col } as CSSProperties}
      data-on={p.on ? "" : undefined}
      data-decoy={m.decoyOf ? "" : undefined}
      data-run={m.runState}
      data-haze={p.haze ? "" : undefined}
    >
      <ScenePress
        className={TOWER}
        data-row="fit"
        data-walk={walkMark("fit")}
        data-lot={fitLot.kind}
        style={towerStyle}
        aria-label={words.cellName(m, "fit", { crown: p.crown, haze: p.haze })}
        onClick={walk("fit")}
        {...press(0)}
      >
        {fitLot.kind === "rated" ? (
          <>
            <span className="lu-tower__body" />
            <span className="lu-tower__band" />
          </>
        ) : (
          <span className="lu-tower__lot">
            <ReasonGlyph reason={fitLot.kind === "boarded" ? fitLot.reason : "pending"} />
          </span>
        )}
        <span className="lu-tower__top" aria-hidden="true">
          {p.crown ? <CrownGlyph /> : null}
          <span className="lu-tower__n">{fit.rating ?? ABSENT}</span>
          {fit.comment ? <PennantGlyph /> : null}
        </span>
      </ScenePress>

      {FLOORS.map((d, i) => {
        const cell = m.cells[d];
        const lot = lotOf(cell);
        const share = litShare(cell);
        return (
          <ScenePress
            key={d}
            className={FLOOR}
            data-row={d}
            data-walk={walkMark(d)}
            data-lot={lot.kind}
            data-tier={cell.tier}
            style={{ "--row": i, "--lit": share ?? 0 } as CSSProperties}
            aria-label={words.cellName(m, d)}
            onClick={walk(d)}
            {...press(i + 1)}
          >
            <span className="lu-win" aria-hidden="true" />
            {/* a floor under construction is its dashed outline alone; the crane hangs once, on the lot */}
            {lot.kind === "boarded" ? <ReasonGlyph reason={lot.reason} /> : null}
            {p.leads.has(d) ? (
              <span className="lu-floor__lead">
                <LeadGlyph />
              </span>
            ) : null}
            {cell.comment ? (
              <span className="lu-floor__note">
                <PennantGlyph />
              </span>
            ) : null}
            {cell.rating != null ? (
              <span className="lu-floor__n" aria-hidden="true">
                {cell.rating}
              </span>
            ) : null}
          </ScenePress>
        );
      })}

      <span className="lu-house" aria-hidden="true">
        {words.house(m)}
      </span>
      <ScenePress
        className={SIGN}
        data-row="sign"
        aria-label={words.t(m.analysisSlug ? "sign" : "signNoReport", { name: m.label, membership: words.t(`membership.${m.membership}`), rank: words.rank(m) })}
        aria-disabled={m.analysisSlug ? undefined : "true"}
        data-membership={m.membership}
        onClick={() => {
          if (m.analysisSlug) p.onOpenReport(m.analysisSlug);
        }}
        {...press(SIGN_ROW)}
      >
        <span className="lu-sign__text">{m.label}</span>
      </ScenePress>
      {p.stop != null ? (
        <span className="lu-stop" aria-hidden="true">
          {p.stop}
        </span>
      ) : null}
    </div>
  );
}
