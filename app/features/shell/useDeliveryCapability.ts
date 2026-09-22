"use client";

import { useEffect, useState } from "react";
import {
  CAPABILITY_CHANNEL,
  UNKNOWN_CAPABILITY,
  createCapabilityCache,
  type Capability,
  type CapabilityCache,
} from "./deliveryCapabilityCache";

// REC-10 — client read of the comms capability bits from /api/comms/capability,
// shared module-wide: many surfaces key their vocabulary off the same facts. The
// facts are LIVE, not boot-time — the outbound relay is saved from the Channels tab
// at runtime — so the read sits in an invalidatable store (deliveryCapabilityCache):
// one read per page while nothing changes, and invalidateCommsCapability() (called
// by the relay editor after a save) makes every mounted consumer, in every window,
// re-read within one round-trip.
//
//   relayConfigured    — is a real OUTBOUND relay configured, or is every "send" a
//                        terminal local-outbox row? (drawer notes, event labels,
//                        lifecycle chips)
//   emailInboundDomain — the INBOUND twin (inbound-setup-honesty): the domain a
//                        configured inbound-email provider routes to a receiver
//                        token, or null when forwarding isn't wired. The Email
//                        intake wizard reads it instead of synthesizing an address
//                        from window.location.
//
// Both ride the SAME request and the SAME cache — a second capability bit must not
// grow a second fetcher.
//
// `relayConfigured` returns null until known. Consumers keep their existing "sent"
// copy for null/true and switch to the honest queued phrasing ONLY on a definite
// false — so an unreachable endpoint never accuses a configured relay of not
// delivering, and a keyless dev install flips to the truth one tick later.
// `emailInboundDomain` is the opposite default: until it is KNOWN to be a real
// domain there is no address to show, so an unresolved read reads as unconfigured
// and the wizard shows the honest not-wired state rather than a guess.

let store: CapabilityCache | null = null;
function commsCapabilityStore(): CapabilityCache {
  store ??= createCapabilityCache({
    fetcher: fetchCapability,
    channel:
      typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(CAPABILITY_CHANNEL)
        : null,
  });
  return store;
}

/** The relay (or any other capability source) changed server-side: drop the cached
 *  record here and in the app's other windows, and re-read for every consumer. */
export function invalidateCommsCapability(): void {
  commsCapabilityStore().invalidate();
}

async function fetchCapability(): Promise<Capability> {
  try {
    const r = await fetch("/api/comms/capability");
    const body = (await r.json().catch(() => null)) as
      | { relayConfigured?: unknown; emailInboundDomain?: unknown }
      | null;
    return {
      relayConfigured: typeof body?.relayConfigured === "boolean" ? body.relayConfigured : null,
      emailInboundDomain:
        typeof body?.emailInboundDomain === "string" && body.emailInboundDomain.trim()
          ? body.emailInboundDomain.trim()
          : null,
    };
  } catch {
    return UNKNOWN_CAPABILITY;
  }
}

/** The whole capability record. `resolved` distinguishes "not fetched yet" from
 *  "fetched, and nothing is configured" — needed by surfaces that would rather
 *  render nothing than flash a wrong state. */
export function useCommsCapability(): Capability & { resolved: boolean } {
  const [state, setState] = useState<Capability | null>(() =>
    typeof window === "undefined" ? null : commsCapabilityStore().peek()
  );
  useEffect(() => {
    let alive = true;
    const cache = commsCapabilityStore();
    const unsubscribe = cache.subscribe((v) => {
      if (alive) setState(v);
    });
    void cache.get().then((v) => {
      if (alive) setState(v);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return { ...(state ?? UNKNOWN_CAPABILITY), resolved: state !== null };
}

/** Is a real OUTBOUND delivery relay wired? null until known (see above). */
export function useDeliveryCapability(): boolean | null {
  return useCommsCapability().relayConfigured;
}
