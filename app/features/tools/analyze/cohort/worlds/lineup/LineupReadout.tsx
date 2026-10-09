"use client";

import { ABSENT, Button } from "@/app/_components/kit";
import type { CohortDimension, CohortMember, CohortView } from "../../cohortTypes";
import { HazeGlyph, LeadGlyph, PennantGlyph, ReasonGlyph } from "./art/LineupGlyphs";
import type { GridCell } from "./lineupGrid";
import { STREET_ROWS, cellBand, floorClaimOf, floorLeaderOf, salaryLineOf } from "./lineupModel";
import type { LineupWords } from "./useLineupWords";

type Props = {
  view: CohortView;
  street: readonly CohortMember[];
  words: LineupWords;
  look: GridCell | null;
  onWalk: (d: CohortDimension, el: HTMLElement, memberId: string | null) => void;
  onOpenReport: (slug: string) => void;
};

const LEGEND = ["tower", "windows", "boarded", "shadow", "pennant", "haze", "stop"] as const;

/**
 * The lobby's directory board beside the street: what the reader points at or walks to, in words. A
 * building lists its seven floors with their short labels (dotted leaders, like a lobby board); the floor
 * being read opens up with its band, its drivers, a clearing lead, the salary line it stands on and its
 * rare comment. A directory entry reads the floor's claim and the model's note. Nothing yet: the legend.
 * The board keeps its height, so reading never moves the street.
 */
export function LineupReadout({ view, street, words, look, onWalk, onOpenReport }: Props) {
  const { t } = words;
  const member = look && look.col > 0 ? street[look.col - 1] ?? null : null;
  const row = look && look.row < STREET_ROWS.length ? STREET_ROWS[look.row] : null;

  if (look && look.col === 0 && row) {
    const claim = floorClaimOf(view, row);
    const note = view.claims.byDimension[row].note;
    return (
      <aside className="lu-board" aria-label={t("readout.label")} data-kind="floor">
        <p className="lu-board__kicker">{words.claimLong(row)}</p>
        <h3 className="lu-board__title">{words.dim(row)}</h3>
        <p className="lu-board__line">{t("level.kicker", { rated: claim.rated, total: view.members.length, claim: words.claimShort(row) })}</p>
        {note ? <p className="lu-board__note">{note}</p> : null}
        <div className="lu-board__acts">
          <Button label={t("readout.walk", { floor: words.dim(row) })} icon="right" onClick={(e) => onWalk(row, e.currentTarget, null)} />
        </div>
      </aside>
    );
  }

  if (!member) {
    return (
      <aside className="lu-board" aria-label={t("readout.label")} data-kind="legend">
        <p className="lu-board__kicker">{t("readout.legend")}</p>
        <ul className="lu-legend">
          {LEGEND.map((k) => (
            <li key={k} data-k={k}>
              <span className="lu-legend__mark">{legendMark(k)}</span>
              <span>{t(`readout.${k}`)}</span>
            </li>
          ))}
        </ul>
        <p className="lu-board__line">{t("readout.idle")}</p>
      </aside>
    );
  }

  return (
    <aside className="lu-board" aria-label={t("readout.label")} data-kind="member" data-decoy={member.decoyOf ? "" : undefined}>
      <p className="lu-board__kicker">{`${t(`membership.${member.membership}`)} · ${words.rank(member)}`}</p>
      <h3 className="lu-board__title">{member.label}</h3>
      {member.decoyOf ? <p className="lu-board__shade">{t("decoy", { name: words.nameOf(member.decoyOf) })}</p> : null}
      <dl className="lu-board__floors">
        {STREET_ROWS.map((d) => {
          const cell = member.cells[d];
          const open = d === row;
          const band = open ? cellBand(cell) : null;
          const lead = floorLeaderOf(view, d) === member.memberId;
          const line = d === "salary" ? salaryLineOf(view, member.memberId) : null;
          return (
            <div key={d} className="lu-board__floor" data-open={open ? "" : undefined} data-absent={cell.rating == null ? "" : undefined}>
              <dt>{words.dim(d)}</dt>
              <dd>
                <span className="lu-board__value">
                  {cell.rating == null ? <ReasonGlyph reason={cell.absentReason ?? "notRead"} /> : null}
                  {cell.rating == null ? `${ABSENT} ${words.reason(cell)}` : words.short(cell.label)}
                  {lead ? <LeadGlyph /> : null}
                  {cell.comment && !open ? <PennantGlyph /> : null}
                </span>
                {open && band ? <span className="lu-board__band">{t("readout.band", { lo: band.lo, hi: band.hi })}</span> : null}
                {open && cell.band?.drivers.length ? <span className="lu-board__drivers">{cell.band.drivers.map(words.short).join(" · ")}</span> : null}
                {open && lead ? <span className="lu-board__lead">{t("readout.lead")}</span> : null}
                {open && d === "salary" && line && !line.main ? <span className="lu-board__drivers">{t("readout.salaryOther", { key: line.key })}</span> : null}
                {open && d === "salary" && cell.rating != null ? <span className="lu-board__drivers">{t("readout.salaryNever")}</span> : null}
                {open && cell.comment ? (
                  <span className="lu-board__comment">
                    <PennantGlyph />
                    {cell.comment}
                  </span>
                ) : null}
              </dd>
            </div>
          );
        })}
      </dl>
      <div className="lu-board__acts">
        {row ? <Button label={t("readout.walk", { floor: words.dim(row) })} icon="right" onClick={(e) => onWalk(row, e.currentTarget, member.memberId)} /> : null}
        {member.analysisSlug ? <Button label={t("readout.open")} icon="open" variant="ghost" onClick={() => onOpenReport(member.analysisSlug as string)} /> : null}
      </div>
    </aside>
  );
}

function legendMark(k: (typeof LEGEND)[number]) {
  switch (k) {
    case "tower":
      return <span className="lu-legend__tower" />;
    case "windows":
      return <span className="lu-legend__win" />;
    case "boarded":
      return <ReasonGlyph reason="notRead" />;
    case "shadow":
      return <span className="lu-legend__shade" />;
    case "pennant":
      return <PennantGlyph />;
    case "haze":
      return <HazeGlyph />;
    case "stop":
      return <span className="lu-legend__stop">{1}</span>;
  }
}
