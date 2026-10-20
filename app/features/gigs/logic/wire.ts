import type { Gig, GigArena, GigAttempt, GigKpi, GigSource, GigSpecialist } from "@/app/_lib/gigs/types";

// ---------------------------------------------------------------------------
// Wire shapes the tab reads (the routes' answers, typed once here)
// ---------------------------------------------------------------------------

export type GigsListAnswer = { gigs: Gig[]; specialists: GigSpecialist[]; attemptsByGig: Record<string, GigAttempt> };

export type SpecialistHire = {
  id: string;
  status: string;
  personaId: string | null;
  personaName: string | null;
  requestId: string | null;
  updatedAt: string;
  lastReportAt: string | null;
};
export type SpecialistRow = GigSpecialist & { hire: SpecialistHire | null };

export type SourceRow = GigSource & { termsCurrent: boolean };

/** What a page calls after a write: `flash` = one sentence for the page's status line.
 *  Answers the re-read KPI, so a verdict can say how the rate moved. */
export type AfterWrite = (flash?: string | null) => Promise<GigKpi | null>;

/** The catalog entry as GET /api/gigs/sources serves it (sources-catalog.ts). Declared
 *  here rather than imported: that module hashes with node:crypto and must stay off the
 *  client graph. */
export type CatalogEntry = {
  adapter: string;
  arena: GigArena | null;
  tier: "A" | "B" | "C";
  label: string;
  host: string | null;
  needsKey: boolean;
  envVars: string[];
  keylessBehaviour: string;
  termsSummary: string;
  termsUrl: string | null;
  termsHash: string | null;
  declines: "no_public_api" | "manual_only" | null;
  creatable: boolean;
  checkedOn: string;
};
