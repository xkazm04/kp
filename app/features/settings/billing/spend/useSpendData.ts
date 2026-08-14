"use client";

import { useCallback, useEffect, useState } from "react";
import type { LlmUsageAggregateRow } from "@/app/_lib/db/llm";
import type { EngineAvailability } from "@/app/_lib/engine-preflight";

// The two server reads the consolidated spend section needs, fetched ONCE for
// whichever view is on screen. The plan/meter half arrives as a prop — the
// Billing tab already fetched /api/billing for the header.
//
// One hook rather than a fetch inside each panel: the last consolidation nested
// a panel that owned its own /api/ops call inside a panel that owned its own
// /api/llm/usage call, so the section had two independent loading states
// stuttering in sequence and two independent failure modes. Here the section has
// exactly one of each.

export type SpendOps = {
  ok: boolean;
  seeds: "ok" | "degraded";
  clock: "healthy" | "starting" | "stalled";
  degradedReasons: string[];
  tables: Record<string, number>;
  queue: { running: number; queued: number };
  engines: EngineAvailability;
  promptCache: { rows: number; expiredBacklog: number };
  analyze: { sampled: number; cacheHitRatePct: number | null; avgDurationMs: number | null };
  engine: { sampled: number; totalTokens7d: number; cachedTokens7d: number; stageAvgMs: Record<string, number> };
  comms: { deadLetters7d: number; sampled: number };
  schedule: { reconcileFailures: number; noSlotStalls: number };
};

export type SpendUsage = {
  days: number;
  rows: LlmUsageAggregateRow[];
  promptCache: { rows: number; expiredBacklog: number };
};

export type SpendData = {
  usage: SpendUsage | null;
  ops: SpendOps | null;
  /** True until the FIRST settle — a later reload never re-blanks what is shown. */
  loading: boolean;
  /** The ledger read failed; the section says so once, for the whole section. */
  failed: boolean;
  reload: () => void;
};

export function useSpendData(): SpendData {
  const [usage, setUsage] = useState<SpendUsage | null>(null);
  const [ops, setOps] = useState<SpendOps | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // State updates happen only in the async callbacks, never synchronously in the
  // effect body; the retry button clears `failed` in its own handler.
  const load = useCallback(() => {
    // The ledger is the section's subject, so its failure is THE failure. Engine
    // telemetry is context: a dead /api/ops leaves those lines out rather than
    // turning the whole section into an error state.
    fetch("/api/llm/usage")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((p) => setUsage(p as SpendUsage))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
    fetch("/api/ops")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => setOps((p as SpendOps | null) ?? null))
      .catch(() => setOps(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const reload = useCallback(() => {
    setFailed(false);
    load();
  }, [load]);

  return { usage, ops, loading, failed, reload };
}
