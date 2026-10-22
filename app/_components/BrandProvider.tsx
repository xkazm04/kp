"use client";

import { createContext, useContext } from "react";
import { DEFAULT_BRAND, type BrandConfig } from "@/app/_lib/brand-config";

// Server-seeded brand context (E-BRD-3). The root layout reads getBrand() once
// (server) and hands it here, so every client component — both sidebars, and later
// the candidate-facing headers — can read the white-label name/logo with no fetch
// and no flash. The accent color is applied separately via BrandStyle (CSS var).

const BrandContext = createContext<BrandConfig>(DEFAULT_BRAND);

// The org name an UNSET organization reads as (org-settings.ts `orgNameFallback`):
// the demo's company on a fixture-seeded install, empty everywhere else. Whether
// fixtures are seeded is a server env fact (db/seed-gate.ts) a client component
// cannot read, so it rides the same server-seeded hand-off as the brand. The default
// is EMPTY: a tree rendered without the provider must never invent a company.
const OrgNameFallbackContext = createContext<string>("");

export function BrandProvider({
  brand,
  orgNameFallback = "",
  children,
}: {
  brand: BrandConfig;
  orgNameFallback?: string;
  children: React.ReactNode;
}) {
  return (
    <BrandContext.Provider value={brand}>
      <OrgNameFallbackContext.Provider value={orgNameFallback}>{children}</OrgNameFallbackContext.Provider>
    </BrandContext.Provider>
  );
}

export function useBrand(): BrandConfig {
  return useContext(BrandContext);
}

/** What `readClientOrgName` falls back to when no org name was ever set. */
export function useOrgNameFallback(): string {
  return useContext(OrgNameFallbackContext);
}
