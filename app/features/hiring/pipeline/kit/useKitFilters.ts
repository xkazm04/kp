"use client";

import { useState } from "react";

/*
 * The kit view's OWN narrowing, on top of the URL-synced board filters (usePipelineFilters): the
 * picked Sieve layer, the role, the waiting-only chip and the brushed match range. It is called
 * BEFORE usePipelineTabState so its signature can join the scope a bulk confirm is stamped with:
 * narrowing the list must de-arm an armed reject / outreach / move exactly like a facet change does
 * (usePipelineBulk: "an armed confirm is stamped with WHAT THE BOARD WAS SHOWING").
 */
export function useKitFilters() {
  const [layer, setLayer] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [needsOnly, setNeedsOnly] = useState(false);
  const [brush, setBrush] = useState<[number, number] | null>(null);
  return {
    layer, role, needsOnly, brush,
    setLayer, setRole, setNeedsOnly, setBrush,
    /** What the kit narrowing adds to "what the board is showing". */
    scope: `${layer ?? ""}|${role ?? ""}|${needsOnly ? 1 : 0}|${brush?.join("-") ?? ""}`,
  };
}

export type KitFilters = ReturnType<typeof useKitFilters>;
