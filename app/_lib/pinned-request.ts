// THE PINNED EGRESS TRANSPORT — closes the TOCTOU half of the DNS-rebinding guard.
//
// `assertPublicHttpsEndpointResolved` (ats-egress-guard.ts) resolves a host and refuses
// any private answer, and then the caller used to hand the URL to `fetch`, which
// resolved the name a SECOND time on its own. A rebinding name answers public to the
// vet and 169.254.169.254 / 127.0.0.1 / ::ffff:a9fe:a9fe to the connect, and nothing
// between the two looked. Measured by scan 94951781 at roughly one win in four, on the
// two deliveries that carry candidate PII and a signature (the comms relay and the ATS
// webhook).
//
// This request resolves ONCE, inside the request itself: node's `lookup` hook is the
// only resolution the socket ever sees, it refuses every private answer with the same
// `isPrivateAddress` the vet uses, and it hands exactly one vetted address to
// connect(). SNI and the Host header still come from the URL, so TLS verifies the
// certificate against the name, not the address. Built on node:https on purpose — no
// undici dispatcher, no new dependency.
//
// It NEVER follows a redirect: a 3xx comes back as a status and the caller decides
// (both callers dead-letter it as a permanent failure). It answers at the response
// head, like fetch, and drains the body so the socket is released.
//
// Server-only (node:https, node:net). Never import it from a client component.

import https from "node:https";
import http from "node:http";
import { isIP, type LookupFunction } from "node:net";
import { defaultHostLookup, isPrivateAddress, type HostLookup } from "./ats-egress-guard.ts";

export type PinnedRequestInit = {
  method: string;
  headers: Record<string, string>;
  body?: string;
  /** Fresh per attempt (AbortSignal.timeout starts counting at creation). An abort
   *  rejects with `signal.reason`, so a timeout keeps fetch's `TimeoutError` name. */
  signal?: AbortSignal;
};

export type PinnedResponse = { ok: boolean; status: number };

export type PinnedRequestOptions = {
  /** The resolver whose ONE answer is dialled. Defaults to node:dns. */
  resolve?: HostLookup;
  /** TEST-ONLY allowances for the real-transport tests, which can only reach a local
   *  server on 127.0.0.1 over plain http. Production callers never pass this. */
  unsafeTestAllowance?: { refuseAddress?: (ip: string) => boolean; allowHttp?: boolean };
};

export type EgressTransport = (url: string, init: PinnedRequestInit, options?: PinnedRequestOptions) => Promise<PinnedResponse>;

let transportOverride: EgressTransport | undefined;

/** Test seam: replace (or, with `undefined`, restore) the transport both egress call
 *  sites dial through — the successor of swapping `globalThis.fetch`. Never called by
 *  production code. */
export function setEgressTransportForTests(fn: EgressTransport | undefined): void {
  transportOverride = fn;
}

/** The `lookup` hook handed to the socket: resolve once, refuse the whole answer if any
 *  address is private (as the vet does), and connect to the first address only. */
function pinnedLookup(resolve: HostLookup, refuse: (ip: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (results) => {
        if (results.length === 0) {
          callback(Object.assign(new Error(`host "${hostname}" did not resolve to any address`), { code: "ENOTFOUND" }), "", 0);
          return;
        }
        const refused = results.find(({ address }) => refuse(address));
        if (refused) {
          callback(
            Object.assign(new Error(`host "${hostname}" resolves to a non-public address (${refused.address})`), { code: "EADDRNOTPUBLIC" }),
            "",
            0,
          );
          return;
        }
        const address = results[0].address;
        const family = isIP(address) || 4;
        // net asks for `all` when it may race families (autoSelectFamily); answer with the
        // one pinned address either way, so there is nothing else to race to.
        if (options.all) (callback as unknown as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [{ address, family }]);
        else callback(null, address, family);
      },
      (err: unknown) => callback(err instanceof Error ? err : new Error(`host "${hostname}" could not be resolved`), "", 0),
    );
  };
}

/** POST/GET `url` to a pinned, vetted address. Rejects on a refused or unresolvable
 *  host, a network error, or an abort; resolves with the status otherwise (3xx included,
 *  never followed). */
export function pinnedRequest(url: string, init: PinnedRequestInit, options: PinnedRequestOptions = {}): Promise<PinnedResponse> {
  if (transportOverride) return transportOverride(url, init, options);
  return new Promise<PinnedResponse>((resolvePromise, reject) => {
    const { signal } = init;
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const allowance = options.unsafeTestAllowance;
    const refuse = allowance?.refuseAddress ?? isPrivateAddress;
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      reject(new Error("invalid URL"));
      return;
    }
    const isHttps = target.protocol === "https:";
    if (!isHttps && !(allowance?.allowHttp && target.protocol === "http:")) {
      reject(new Error(`refused: only https endpoints are dialled (got ${target.protocol})`));
      return;
    }
    // An IP-literal host never reaches `lookup` (net skips resolution for it), so it is
    // judged here. The callers' vet already refuses literals; this keeps the transport
    // whole on its own.
    const host = target.hostname.replace(/^\[/, "").replace(/\]$/, "");
    if (isIP(host) && refuse(host)) {
      reject(new Error(`refused: ${host} is a non-public address`));
      return;
    }

    let settled = false;
    const onAbort = () => {
      req.destroy();
      if (!settled) {
        settled = true;
        reject(signal?.reason ?? new Error("aborted"));
      }
    };
    const transport = isHttps ? https : http;
    const req = transport.request(
      target,
      {
        method: init.method,
        headers: init.headers,
        // No pooled socket: every request dials through its own pinned lookup.
        agent: false,
        lookup: pinnedLookup(options.resolve ?? defaultHostLookup, refuse),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // Drain and discard: nothing reads the body, and an unread body holds the socket.
        res.resume();
        res.on("end", () => signal?.removeEventListener("abort", onAbort));
        res.on("error", () => {
          /* best-effort drain: the status is already the answer */
        });
        if (!settled) {
          settled = true;
          resolvePromise({ ok: status >= 200 && status < 300, status });
        }
      },
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    req.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}
