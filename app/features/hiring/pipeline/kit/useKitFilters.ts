"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { buildUrl } from "@/app/features/shell/tabs";
import { useShellNavigate } from "@/app/features/shell/nav/shallow-nav";
import { initialScope, roleParam } from "./rolesBoardModel";

/*
 * The kit view's OWN narrowing, on top of the URL-synced board filters (usePipelineFilters): the
 * picked Sieve layer, the role, the waiting-only chip and the brushed match range. It is called
 * BEFORE usePipelineTabState so its signature can join the scope a bulk confirm is stamped with:
 * narrowing the list must de-arm an armed reject / outreach / move exactly like a facet change does
 * (usePipelineBulk: "an armed confirm is stamped with WHAT THE BOARD WAS SHOWING").
 *
 * `role` is also the page's LEVEL: null is the roles board alone (level 1); a lane key, or ALL for
 * every role at once, opens that scope's pipeline under the board (level 2). It is a deep link:
 * `?role=<job id or title>` / `?role=all` lands on level 2 (rolesBoardModel.initialScope), and a pick
 * writes it back with the same shallow replace the board filters use.
 */
export function useKitFilters() {
  const nav = useShellNavigate();
  const search = useSearchParams();
  const [layer, setLayer] = useState<string | null>(null);
  const [role, setRoleState] = useState<string | null>(() => initialScope((k) => search.get(k)));
  const [needsOnly, setNeedsOnly] = useState(false);
  const [brush, setBrush] = useState<[number, number] | null>(null);
  const setRole = (next: string | null) => {
    setRoleState(next);
    nav.replace(buildUrl({ role: roleParam(next) }, search.toString()));
  };
  return {
    layer, role, needsOnly, brush,
    setLayer, setRole, setNeedsOnly, setBrush,
    /** Open a scope (a role, or ALL) at level 2, optionally on one stage; a new scope drops the brush. */
    open: (scope: string, stage: string | null = null) => {
      if (scope !== role) setBrush(null);
      setRole(scope);
      setLayer(stage);
    },
    /** Back to the roles board. */
    close: () => {
      setRole(null);
      setLayer(null);
      setBrush(null);
    },
    /** What the kit narrowing adds to "what the board is showing". */
    scope: `${layer ?? ""}|${role ?? ""}|${needsOnly ? 1 : 0}|${brush?.join("-") ?? ""}`,
  };
}

export type KitFilters = ReturnType<typeof useKitFilters>;
