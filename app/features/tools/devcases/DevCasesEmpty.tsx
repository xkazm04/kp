"use client";

import { LoadStatus } from "@/app/_components/LoadStatus";
import type { LoadState } from "@/app/_lib/useLoader";
import { CasesEmptyLedger } from "./DevCasesEmptyLedger";

/* The first-run empty Cases list (cases.length === 0).
 *
 * Reads as a sealed ledger: a case is evidence, and this list is where that
 * evidence accrues. Zero sealed submissions, plus the six anti-delegation
 * controls drawn as a chain — each phrased as what it PROVES about a candidate,
 * which is the whole argument for the module in an LLM-era hiring market. */

export function CasesEmpty({ state, onDefine }: { state: LoadState; onDefine: () => void }) {
  return (
    <div className="space-y-3">
      <LoadStatus state={state} label="dev cases" />
      <CasesEmptyLedger onDefine={onDefine} />
    </div>
  );
}
