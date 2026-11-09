"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveRefresh } from "@/app/features/shell/live-refresh";
import type { ConnectorId } from "@/app/_lib/connect/catalog";
import { loadDeck, pressProbe, replayDelivery, type ProbeOutcome, type ReplayOutcome } from "./connectorsDeckReads";
import type { ConnectorWire } from "./connectorsDeckModel";
import type { AtsDeliveries } from "./atsDeliveriesModel";

/**
 * The connectors deck's state, read in the shell (level 0 draws its summary and its needs): the
 * catalog and the outbound ATS delivery ledger, read on mount, on every live refresh and whenever
 * `rereadKey` changes (the shell bumps it on each return to the plumbing). The reads are `loadDeck`: GETs only, never a probe.
 *
 * `probe(id)` is the ONE way a probe runs, and only from a press: it is not called by any effect
 * here (connectorsDeckReads.test.ts reads this file to keep it that way). smtp is never probed
 * at all; its press answers `sender` without a request.
 */
export function useConnectorsDeck(rereadKey: number) {
  const [connectors, setConnectors] = useState<ConnectorWire[] | null>(null);
  const [ats, setAts] = useState<AtsDeliveries | null>(null);
  const [replaying, setReplaying] = useState<number | null>(null);
  const [settled, setSettled] = useState(false);
  const [busy, setBusy] = useState<ConnectorId | null>(null);
  const alive = useRef(true);

  const load = useCallback(() => {
    void loadDeck().then((r) => {
      if (!alive.current) return;
      if (r.connectors) setConnectors(r.connectors);
      if (r.ats) setAts(r.ats);
      setSettled(true);
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

  const probe = useCallback(async (id: ConnectorId): Promise<ProbeOutcome> => {
    setBusy(id);
    const out = await pressProbe(id);
    if (alive.current) {
      setBusy(null);
      if (out.kind === "row") setConnectors((rows) => rows?.map((r) => (r.id === out.row.id ? out.row : r)) ?? rows);
    }
    return out;
  }, []);

  /** Replay one dead delivery (the route's POST { replayId }), then re-read the ledger. */
  const replay = useCallback(
    async (id: number): Promise<ReplayOutcome> => {
      setReplaying(id);
      const out = await replayDelivery(id);
      if (alive.current) {
        setReplaying(null);
        load();
      }
      return out;
    },
    [load],
  );

  return { connectors, ats, settled, busy, replaying, probe, replay, reload: load };
}

export type ConnectorsDeckState = ReturnType<typeof useConnectorsDeck>;
