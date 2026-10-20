// The comms capability record as a LIVE fact with a pushed invalidation — the
// DOM-free store under useCommsCapability / useDeliveryCapability.
//
// It used to be a boot cache ("fetched ONCE per page load … they only change with a
// server restart"), but the outbound relay is UI-configurable from the Channels tab
// (comms-relay.ts resolves env → stored config per call), so the fact changes while
// the page is open. Per swr-design, a pushed invalidation beats any timer: the relay
// editor calls invalidate() after a save, every subscribed surface re-reads within
// one round-trip, and while nothing changes it is still ONE read per page.
//
//   - in-flight dedupe: concurrent get()s share one fetch;
//   - the UNKNOWN record (a failed or refused read) is never cached, so the next
//     get() retries — the rule the hook always had;
//   - a generation guard: a read that started before an invalidate() never lands
//     as the cached value nor reaches a subscriber (a slow boot read answering
//     "no relay" after the operator just saved one would otherwise win);
//   - cross-window: invalidate() posts a DEDICATED `capability-changed` message on
//     its own channel. It deliberately does not ride live-refresh's untyped
//     "changed" bus — that fires on every pipeline mutation and would refetch the
//     capability each time. A received invalidation is not re-posted (no ping-pong).

export type Capability = { relayConfigured: boolean | null; emailInboundDomain: string | null };

export const UNKNOWN_CAPABILITY: Capability = { relayConfigured: null, emailInboundDomain: null };

export const CAPABILITY_CHANGED = "capability-changed";
export const CAPABILITY_CHANNEL = "kp:comms-capability";

/** The slice of BroadcastChannel the store needs — a stub in tests. */
export type CapabilityChannel = {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (e: { data: unknown }) => void): void;
};

export type CapabilityCache = {
  /** The cached KNOWN record, or null when nothing is cached. Synchronous. */
  peek(): Capability | null;
  /** The record: cached, the in-flight read, or a new read. Always the answer of
   *  the CURRENT generation — a caller whose read was invalidated is handed the
   *  fresh one. */
  get(): Promise<Capability>;
  /** Drop the cached record, announce it to other windows, and refetch when
   *  anyone is subscribed. */
  invalidate(): void;
  /** Hear every current-generation read as it settles. Returns the unsubscribe. */
  subscribe(listener: (v: Capability) => void): () => void;
};

const isKnown = (v: Capability) => v.relayConfigured !== null || v.emailInboundDomain !== null;

export function createCapabilityCache(opts: {
  fetcher: () => Promise<Capability>;
  channel?: CapabilityChannel | null;
}): CapabilityCache {
  const { fetcher, channel = null } = opts;
  let cached: Capability | null = null;
  let inflight: Promise<Capability> | null = null;
  let generation = 0;
  const listeners = new Set<(v: Capability) => void>();

  function get(): Promise<Capability> {
    if (cached !== null) return Promise.resolve(cached);
    if (inflight) return inflight;
    const gen = generation;
    const read: Promise<Capability> = fetcher()
      .catch(() => UNKNOWN_CAPABILITY)
      .then((v) => {
        // Invalidated while this read was on the wire: its answer predates the
        // change, so it is neither cached nor delivered — defer to the new read.
        if (gen !== generation) return get();
        inflight = null;
        if (isKnown(v)) cached = v;
        for (const l of [...listeners]) l(v);
        return v;
      });
    inflight = read;
    return read;
  }

  function drop(): void {
    generation++;
    cached = null;
    inflight = null;
    if (listeners.size > 0) void get();
  }

  channel?.addEventListener("message", (e) => {
    const data = e.data as { type?: unknown } | null;
    if (data && typeof data === "object" && data.type === CAPABILITY_CHANGED) drop();
  });

  return {
    peek: () => cached,
    get,
    invalidate() {
      try {
        channel?.postMessage({ type: CAPABILITY_CHANGED });
      } catch {
        /* channel closed mid-teardown — this window still invalidates below */
      }
      drop();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
