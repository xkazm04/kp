"use client";

// The orchard itself: ONE CSS grid — a header per salary branch, then per score band
// a divider spanning every column and that band's row of branch cells. One grid,
// not a grid per band, because the columns must line up across bands.

import type { CardTier } from "../mapTypes";
import { ORCHARD_COPY as COPY } from "./orchardCopy";
import { branchFit, cornerCallouts, type BandRow, type SalaryBranch } from "./orchardLayout";
import { BandDivider, Branch, BranchHeader } from "./OrchardBranch";
import { TICKET_WIDTH, type TicketDeps } from "./OrchardTicket";

/** Gutter added to a ticket's width to size a branch column. */
const BRANCH_GUTTER = 40;

export function OrchardGrid({
  branches,
  rows,
  tier,
  roleBand,
  deps,
}: {
  branches: readonly SalaryBranch[];
  rows: readonly BandRow[];
  tier: CardTier;
  roleBand: [number, number] | null;
  deps: TicketDeps;
}) {
  if (rows.length === 0) {
    return <p className="px-2 py-10 text-center text-sm text-steel">{COPY.emptyLane}</p>;
  }
  const { gemsAt, prosAt } = cornerCallouts(rows);
  const columnWidth = TICKET_WIDTH[tier] + BRANCH_GUTTER;

  return (
    <div
      className="grid items-start gap-x-4 pb-4 pt-3"
      style={{ gridTemplateColumns: `repeat(${branches.length}, minmax(${columnWidth}px, 1fr))` }}
    >
      {branches.map((branch) => (
        <BranchHeader key={branch.lo} branch={branch} fit={branchFit(branch, roleBand)} money={deps.money} />
      ))}
      {rows.map((row, r) => (
        <BandRowCells
          key={row.band}
          row={row}
          branches={branches}
          tier={tier}
          gemsAt={r === 0 ? gemsAt : -1}
          prosAt={r === 0 ? prosAt : -1}
          deps={deps}
        />
      ))}
    </div>
  );
}

function BandRowCells({
  row,
  branches,
  tier,
  gemsAt,
  prosAt,
  deps,
}: {
  row: BandRow;
  branches: readonly SalaryBranch[];
  tier: CardTier;
  gemsAt: number;
  prosAt: number;
  deps: TicketDeps;
}) {
  return (
    <>
      <BandDivider band={row.band} count={row.total} />
      {branches.map((branch, i) => (
        <Branch
          key={branch.lo}
          entries={row.cells[i] ?? []}
          tier={tier}
          callout={i === prosAt ? COPY.professionals : i === gemsAt ? COPY.gems : null}
          deps={deps}
        />
      ))}
    </>
  );
}
