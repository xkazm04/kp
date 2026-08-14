"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DECISION_META } from "@/app/_lib/decision-attribution";
import { buildUrl as buildTabUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import { DecisionLogTable } from "./sections/DecisionLogTable";

// Auditable decision log over the full automation/human trail.
//
// Was an infinite scroll; it is now a sortable, filterable, PAGED table (see
// sections/DecisionLogTable.tsx for why). This file keeps what it always owned:
// the filter state, and the deep-link contract around it.
//
// Direction 3 — the kind filter is deep-linkable: it hydrates from ?kind= at
// mount and writes back on every change (the board's PIPE3 two-way URL-sync
// idiom), so a filtered log is reload- and share-stable and a cross-tab CTA (the
// Decisions comms-failure banner) can land here pre-filtered. Only the kind
// filter syncs — a specific kind wins over the broader attribution bucket anyway,
// and attribution stays local/ephemeral.
//
// The table no longer needs a remount key: the old infinite-scroll engine
// accumulated pages per mount, so a filter change had to throw the whole list
// away and start from offset 0. A paged table just re-fetches with new params
// and resets to page 1 itself.
export function DecisionLog() {
  const search = useSearchParams();
  const router = useRouter();
  const [attribution, setAttribution] = useState<"auto" | "human" | null>(null);
  // Hydrate ONCE from the URL (lazy initializer off the render-time params, like
  // PipelineTab); an unknown kind falls back to unfiltered rather than a dead view.
  const [kind, setKindState] = useState(() => {
    const k = search.get("kind");
    return k && k in DECISION_META ? k : "";
  });
  const setKind = useCallback(
    (k: string) => {
      setKindState(k);
      // Write back to the same ?kind= param the mount reads. buildTabUrl preserves
      // tab + every other param and clears the key when the filter is emptied.
      router.replace(buildTabUrl({ kind: k || null }, search.toString()), { scroll: false });
    },
    [router, search]
  );

  // Direction 2 — reuse the board deep-link idiom (buildUrl + cleared tab-scoped
  // params, ?q=<label>) the funnel/by-role links use, so a log row opens the
  // board filtered to that candidate.
  const boardHref = useCallback(
    (q: string) => buildTabUrl({ ...clearedTabScopedParams(), tab: "pipeline", q }, search.toString()),
    [search]
  );

  return (
    <DecisionLogTable
      attribution={attribution}
      kind={kind}
      setAttribution={setAttribution}
      setKind={setKind}
      boardHref={boardHref}
    />
  );
}
