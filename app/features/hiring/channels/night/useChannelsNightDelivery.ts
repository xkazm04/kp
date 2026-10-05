"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveRefresh } from "@/app/features/shell/live-refresh";
import { useCommsCapability } from "@/app/features/shell/useDeliveryCapability";
import { readEdgeConfig, readRelayConfig, type EdgeState, type RelayHealthWord } from "./channelsNightReads";

/**
 * The two delivery facts the plumbing draws (the relay's health word, the edge's drain ledger),
 * read once on mount, again on every live refresh (a relay save announces one), and again
 * whenever `rereadKey` changes (the shell bumps it on every return to the plumbing, because the
 * edge editor saves without announcing). A failed read keeps the last known value; `settled`
 * turns true once both first reads finished, ok or not.
 *
 * The relay's word comes from GET /api/comms/relay; a seat that GET refuses (a demo session)
 * still has the capability bit, which can prove configured / unconfigured but never unreadable.
 */
export function useChannelsNightDelivery(rereadKey: number) {
  const [relay, setRelay] = useState<RelayHealthWord | null>(null);
  const [edge, setEdge] = useState<EdgeState | null>(null);
  const [done, setDone] = useState({ relay: false, edge: false });
  const alive = useRef(true);
  const { relayConfigured } = useCommsCapability();

  const load = useCallback(() => {
    void readRelayConfig().then((r) => {
      if (!alive.current) return;
      if (r) setRelay(r.relay);
      setDone((d) => (d.relay ? d : { ...d, relay: true }));
    });
    void readEdgeConfig().then((e) => {
      if (!alive.current) return;
      if (e) setEdge(e);
      setDone((d) => (d.edge ? d : { ...d, edge: true }));
    });
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load, rereadKey]);
  useLiveRefresh(load);

  const health: RelayHealthWord | null = relay ?? (relayConfigured === null ? null : relayConfigured ? "configured" : "unconfigured");
  return { relay: health, edge, settled: done.relay && done.edge };
}
