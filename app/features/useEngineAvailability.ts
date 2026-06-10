"use client";

import { useEffect, useState } from "react";
import type { EngineAvailability } from "@/app/_lib/engine-preflight";

// DATA4 — client read of the engine preflight. Fetched once on mount from
// /api/health; the body carries `engines` even on a 503 (a degraded readiness
// probe still answers), so parse regardless of status. null until known —
// consumers render no warning while loading, never a false alarm.
export function useEngineAvailability(): EngineAvailability | null {
  const [engines, setEngines] = useState<EngineAvailability | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/health")
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as { engines?: EngineAvailability } | null;
        if (alive && body?.engines) setEngines(body.engines);
      })
      .catch(() => {
        /* unreachable — stay null, surfaces simply show no hint */
      });
    return () => {
      alive = false;
    };
  }, []);
  return engines;
}
