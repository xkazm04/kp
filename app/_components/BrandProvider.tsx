"use client";

import { createContext, useContext } from "react";
import { DEFAULT_BRAND, type BrandConfig } from "@/app/_lib/brand-config";

// Server-seeded brand context (E-BRD-3). The root layout reads getBrand() once
// (server) and hands it here, so every client component — both sidebars, and later
// the candidate-facing headers — can read the white-label name/logo with no fetch
// and no flash. The accent color is applied separately via BrandStyle (CSS var).

const BrandContext = createContext<BrandConfig>(DEFAULT_BRAND);

export function BrandProvider({ brand, children }: { brand: BrandConfig; children: React.ReactNode }) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandConfig {
  return useContext(BrandContext);
}
