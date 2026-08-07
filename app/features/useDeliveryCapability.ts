"use client";

import { useEffect, useState } from "react";

// REC-10 — client read of the delivery capability bit (is a real comms relay
// configured, or is every "send" a terminal local-outbox row?). Fetched once
// per page load and cached module-wide: many surfaces (drawer notes, event
// labels, lifecycle chips) key their sent/queued vocabulary off the same bit,
// and it only changes with a server restart.
//
// Returns null until known. Consumers keep their existing "sent" copy for
// null/true and switch to the honest queued phrasing ONLY on a definite false —
// so an unreachable endpoint never accuses a configured relay of not
// delivering, and a keyless dev install flips to the truth one tick later.
let cached: boolean | null = null;
let inflight: Promise<boolean | null> | null = null;

async function fetchCapability(): Promise<boolean | null> {
  try {
    const r = await fetch("/api/comms/capability");
    const body = (await r.json().catch(() => null)) as { relayConfigured?: unknown } | null;
    return typeof body?.relayConfigured === "boolean" ? body.relayConfigured : null;
  } catch {
    return null;
  }
}

export function useDeliveryCapability(): boolean | null {
  const [relayConfigured, setRelayConfigured] = useState<boolean | null>(cached);
  useEffect(() => {
    if (cached !== null) return;
    let alive = true;
    inflight ??= fetchCapability().then((v) => {
      if (v !== null) cached = v;
      inflight = null;
      return v;
    });
    void inflight.then((v) => {
      if (alive) setRelayConfigured(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return relayConfigured;
}
