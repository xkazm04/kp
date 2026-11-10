"use client";

import { useEffect, useState } from "react";
import { DEFAULT_MARKET_ID, MARKETS, resolveMarketId, type MarketSpec } from "./markets";

// The session workspace's market for a client surface that labels a figure. ONE fetch
// per page load (the promise is shared by every caller), re-run after the Settings
// picker saves. Until it lands — and on any failure — the default market, which is what
// the surface rendered before markets existed; a figure that carries its OWN currency
// must keep using that, never this.
let pending: Promise<MarketSpec> | null = null;

function load(): Promise<MarketSpec> {
  pending ??= fetch("/api/workspace/market")
    .then((r) => (r.ok ? r.json() : null))
    .then((body: { market?: { id?: unknown } } | null) => MARKETS[resolveMarketId(body?.market?.id)])
    .catch(() => {
      pending = null; // a failed read is retried by the next mount, not cached
      return MARKETS[DEFAULT_MARKET_ID];
    });
  return pending;
}

/** Drop the shared read so the next mount sees a market the picker just saved. */
export function invalidateWorkspaceMarket(): void {
  pending = null;
}

export function useWorkspaceMarket(): MarketSpec {
  const [market, setMarket] = useState<MarketSpec>(MARKETS[DEFAULT_MARKET_ID]);
  useEffect(() => {
    let live = true;
    void load().then((m) => {
      if (live) setMarket(m);
    });
    return () => {
      live = false;
    };
  }, []);
  return market;
}
