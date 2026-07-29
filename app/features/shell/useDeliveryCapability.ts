"use client";

import { useEffect, useState } from "react";

// REC-10 — client read of the comms capability bits, fetched ONCE per page load
// from /api/comms/capability and cached module-wide: many surfaces key their
// vocabulary off the same facts, and they only change with a server restart.
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

type Capability = { relayConfigured: boolean | null; emailInboundDomain: string | null };

const UNKNOWN: Capability = { relayConfigured: null, emailInboundDomain: null };

let cached: Capability | null = null;
let inflight: Promise<Capability> | null = null;

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
    return UNKNOWN;
  }
}

/** The whole capability record. `resolved` distinguishes "not fetched yet" from
 *  "fetched, and nothing is configured" — needed by surfaces that would rather
 *  render nothing than flash a wrong state. */
export function useCommsCapability(): Capability & { resolved: boolean } {
  const [state, setState] = useState<Capability | null>(cached);
  useEffect(() => {
    if (cached !== null) return;
    let alive = true;
    inflight ??= fetchCapability().then((v) => {
      // Only a read that told us SOMETHING is worth caching; a failed fetch stays
      // retryable on the next mount (matches the previous null-not-cached rule).
      if (v.relayConfigured !== null || v.emailInboundDomain !== null) cached = v;
      inflight = null;
      return v;
    });
    void inflight.then((v) => {
      if (alive) setState(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return { ...(state ?? UNKNOWN), resolved: state !== null };
}

/** Is a real OUTBOUND delivery relay wired? null until known (see above). */
export function useDeliveryCapability(): boolean | null {
  return useCommsCapability().relayConfigured;
}
