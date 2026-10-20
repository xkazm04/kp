"use client";

// The seam the walkthrough runs the REAL flow components through: when this context holds a
// source, the role picker, the cast step, the add control and the run sheet read it instead of
// the routes (and fetch nothing); without one (the live flow, the default) they are unchanged.
// Tiny on purpose — it sits on the live graph; everything walkthrough-only loads behind dynamic().
import { createContext, useContext } from "react";
import type { CohortProposal, CohortRunRequest } from "./cohortTypes";
import type { PopulationLite } from "./cohortProposalEdits";
import type { CohortRole } from "./useCohortLists";

export interface WalkthroughSource {
  roles: CohortRole[];
  proposalFor: (jdSlug: string) => CohortProposal | null;
  population: readonly PopulationLite[];
  /** Start the simulated run; answers the id the flow's compare step finds it under. Writes nothing. */
  start: (request: CohortRunRequest) => string;
}

export const CohortWalkthroughContext = createContext<WalkthroughSource | null>(null);

/** The walkthrough's source, or null in the live flow. */
export const useWalkthroughSource = (): WalkthroughSource | null => useContext(CohortWalkthroughContext);
