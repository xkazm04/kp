"use client";

// The pieces of the orchard grid: a branch's header (its salary range, head-count
// and stance against the role band), the band divider that reads across every
// branch, and the branch cell itself — a trunk with tickets on twigs.

import { EYEBROW, META_LABEL } from "@/app/_components/ui/recipes";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { TONE_BAR, TONE_TEXT } from "../mapTone";
import type { CardTier } from "../mapTypes";
import type { MapMoney } from "../useMapMoney";
import { BAND_LABEL, FIT_LABEL } from "./orchardCopy";
import type { BranchFit, SalaryBranch, ScoreBand } from "./orchardLayout";
import { Ticket, type TicketDeps } from "./OrchardTicket";

export function BranchHeader({
  branch,
  fit,
  money,
}: {
  branch: SalaryBranch;
  fit: BranchFit | null;
  money: MapMoney;
}) {
  const tint = fit === "inside" ? "border-moss/30 bg-limewash/40" : "border-stone-200 bg-white";
  return (
    <div className={`rounded-lg border px-3 py-2 ${tint}`}>
      <p className="nums text-sm font-semibold text-ink">{money.range(branch.lo, branch.hi)}</p>
      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
        <span className="nums text-sm text-steel">{branch.ids.length}</span>
        {fit ? <span className={META_LABEL}>{FIT_LABEL[fit]}</span> : null}
      </p>
    </div>
  );
}

/** The horizontal read: a tone dot, a name, a count, a rule across every branch. */
export function BandDivider({ band, count }: { band: ScoreBand; count: number }) {
  return (
    <div className="flex items-center gap-2 pb-1 pt-4" style={{ gridColumn: "1 / -1" }}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_BAR[band]}`} aria-hidden="true" />
      <span className={META_LABEL}>{BAND_LABEL[band]}</span>
      <span className={`nums text-sm ${TONE_TEXT[band]}`}>{count}</span>
      <span className="h-px flex-1 bg-stone-200" aria-hidden="true" />
    </div>
  );
}

/** One (salary range × score band) cell. The trunk is drawn even when empty: it is
 *  the column's spine, and a gap would read as "the branch ends here". */
export function Branch({
  entries,
  tier,
  callout,
  deps,
}: {
  entries: readonly Entry[];
  tier: CardTier;
  callout: string | null;
  deps: TicketDeps;
}) {
  return (
    <div className="flex min-h-8 flex-col gap-3 border-l-2 border-stone-200 py-1">
      {callout && entries.length > 0 ? <span className={`${EYEBROW} pl-3`}>{callout}</span> : null}
      {/* Tickets WRAP inside the branch: a crowded branch would otherwise be one
          5-metre column. Reading order stays best-first left→right, top→down. */}
      <div className="flex flex-wrap gap-x-2 gap-y-3">
        {entries.map((e) => (
          <div key={e.id} className="flex items-start">
            <span className="mt-5 block w-3 shrink-0 border-t-2 border-stone-200" aria-hidden="true" />
            <Ticket entry={e} tier={tier} deps={deps} />
          </div>
        ))}
      </div>
    </div>
  );
}
