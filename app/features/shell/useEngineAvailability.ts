"use client";

import { useEffect, useState } from "react";
import type { EngineAvailability } from "@/app/_lib/engine-preflight";

/** What the preflight read actually knows. `unknown` is the third state the old
 *  hook could not express: the probe FAILED (offline, a proxy eating /api/health,
 *  a 500 with no body), which is not the same as "not loaded yet" and certainly
 *  not the same as "every engine is fine". Both collapsed to `null`, so a failed
 *  health check silently withdrew the keyless warning — the surface went quiet at
 *  exactly the moment it had least reason to be confident. */
export type EngineAvailabilityRead = {
  engines: EngineAvailability | null;
  /** True once the probe has failed and no engine map was obtained. */
  unknown: boolean;
};

// DATA4 — client read of the engine preflight. Fetched once on mount from
// /api/health; the body carries `engines` even on a 503 (a degraded readiness
// probe still answers), so parse regardless of status. Before the first answer
// both fields are quiet (null / false), so a surface renders no hint while
// loading and never a false alarm.
export function useEngineAvailabilityRead(): EngineAvailabilityRead {
  const [read, setRead] = useState<EngineAvailabilityRead>({ engines: null, unknown: false });
  useEffect(() => {
    let alive = true;
    fetch("/api/health")
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as { engines?: EngineAvailability } | null;
        if (!alive) return;
        if (body?.engines) setRead({ engines: body.engines, unknown: false });
        // A 2xx/503 whose body carries no engine map is just as uninformative as
        // an unreachable probe — say so rather than staying silent.
        else setRead({ engines: null, unknown: true });
      })
      .catch(() => {
        // Unreachable probe. NOT swallowed: the caller shows "engine status
        // unknown" so a keyless operator is not told, by omission, that the run
        // ahead of them is fine.
        if (alive) setRead({ engines: null, unknown: true });
      });
    return () => {
      alive = false;
    };
  }, []);
  return read;
}

/** The engine map alone, for surfaces that only branch on a known engine
 *  (SchedulerControl). Prefer {@link useEngineAvailabilityRead} on any surface
 *  that should distinguish "unknown" from "fine". */
export function useEngineAvailability(): EngineAvailability | null {
  return useEngineAvailabilityRead().engines;
}
