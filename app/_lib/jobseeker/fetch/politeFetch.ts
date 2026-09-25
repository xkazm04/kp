// The ONE door every job-seeker adapter fetches through (ADR 0009 §3).
//
// Politeness is a relationship with a HOST, so its state is keyed by host and lives
// in this module: the robots.txt verdict (cached 24 h), the next moment a request to
// that host may leave (Crawl-delay or a 2 s floor, plus a per-source jitter), and a
// single in-flight request per host. A denial — 401/403/429 or a bot-wall
// interstitial on a 200 — is classified `blocked` and is NEVER retried here; the
// caller pauses the source and the owner decides. `KP_OFFLINE` answers `offline`
// before any network, so an air-gapped install never even resolves a hostname.
//
// The clock and the fetch implementation are injectable so the politeness arithmetic
// runs on a fake clock in tests (politeFetch.test.ts) with zero real sleeps.

import { isOffline } from "../../offline";
import { crawlDelayFor, CRAWLER_TOKEN, isPathAllowed, parseRobots, type RobotsRules } from "./robots";

export type FetchFailureKind = "blocked" | "outage" | "gone" | "robots_disallowed" | "offline";

export type FetchOk = {
  kind: "ok";
  status: number;
  contentType: string;
  /** The decoded body, empty when `stream: true` was requested. */
  body: string;
  finalUrl: string;
  /** Only with `stream: true`: the raw byte stream, for a caller that must never
   *  buffer the whole response (the MPSV bulk file). The 2 MB cap does not apply —
   *  the caller bounds by items instead. */
  stream: ReadableStream<Uint8Array> | null;
};

export type FetchFailure = { kind: FetchFailureKind; status?: number; detail: string };

export type FetchOutcome = FetchOk | FetchFailure;

export type PoliteFetchOptions = {
  /** Seeds the per-host jitter so two sources on one host do not fire in lockstep. */
  sourceId: string;
  /** Override the politeness key (default: the URL's hostname). */
  host?: string;
  accept?: string;
  acceptLanguage?: string;
  method?: "GET" | "HEAD" | "POST";
  body?: string;
  contentType?: string;
  /** Hand back `response.body` instead of buffering (see FetchOk.stream). */
  stream?: boolean;
  /** An `Authorization` header value for an official API that needs one (the gig
   *  adapters: GitHub, Kaggle, HackerOne, Upwork). Sent ONLY to the host the request
   *  started on - a redirect onto another host drops it, so a credential never follows
   *  a hop off the API it was issued for. Never logged. */
  authorization?: string;
  /** Vets every redirect TARGET before it is requested (the gig researcher passes kp's
   *  public-host egress guard here, so a link to a public page cannot bounce the fetch onto
   *  a private address). Answers a refusal reason, or null to allow the hop. */
  hopGuard?: (next: URL) => Promise<string | null>;
};

export type PoliteFetch = (url: string, opts: PoliteFetchOptions) => Promise<FetchOutcome>;

export const USER_AGENT = `${CRAWLER_TOKEN}/1.0 (+https://github.com/xkazm04/kp; owner-operated)`;
export const DEFAULT_ACCEPT = "application/ld+json, application/json;q=0.9, text/html;q=0.8, application/xml;q=0.7, */*;q=0.1";

/** Same bound as job-posting-fetch.ts: the abort signal IS the timeout on a self-host.
 *  It covers the whole exchange of a buffered request; in stream mode it ends when the
 *  headers arrive and the two stream deadlines below take over. */
export const FETCH_TIMEOUT_MS = 15_000;
/** Stream mode: no byte from upstream for this long and the body is cut. */
export const STREAM_IDLE_TIMEOUT_MS = 20_000;
/** Stream mode: the most a body may take from headers to its last byte. */
export const STREAM_TOTAL_TIMEOUT_MS = 120_000;
/** A listing or detail page is tens of kB; two megabytes is a download, not a page. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** No host is asked more often than this, whatever robots.txt says or omits. */
export const MIN_SPACING_MS = 2_000;
/** The jitter band added on top of the spacing; the offset inside it is a hash of the source id. */
export const JITTER_BAND_MS = 700;
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;
/** A robots.txt that answered 5xx: the host is having a bad hour, not a bad day. */
const ROBOTS_OUTAGE_TTL_MS = 60 * 60 * 1000;
const MAX_REDIRECTS = 5;

/** The bot-wall signatures a 200 can hide behind. Kept SHORT on purpose: every entry
 *  is a string that appears in the challenge page itself and nowhere in a job
 *  advertisement, so a false `blocked` (which pauses the source) is not a risk worth
 *  a longer list. Cloudflare's challenge title and its two script hooks, Cloudflare's
 *  block page title, and the two captcha widgets. */
export const INTERSTITIAL_SIGNATURES: readonly string[] = [
  "<title>Just a moment...</title>",
  "cf-browser-verification",
  "/cdn-cgi/challenge-platform/",
  "Attention Required! | Cloudflare",
  "g-recaptcha",
  "h-captcha",
];

type Clock = { now(): number; sleep(ms: number): Promise<void> };

type Deps = Clock & { fetch: typeof fetch };

const realDeps: Deps = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  fetch: (input, init) => globalThis.fetch(input, init),
};

let deps: Deps = realDeps;

type RobotsEntry = { fetchedAt: number; ttlMs: number; rules: RobotsRules | null; outage: boolean };

const robotsCache = new Map<string, RobotsEntry>();
const robotsWarned = new Set<string>();
const nextAllowedAt = new Map<string, number>();
const hostQueue = new Map<string, Promise<void>>();

export function _resetPolitenessForTests(): void {
  robotsCache.clear();
  robotsWarned.clear();
  nextAllowedAt.clear();
  hostQueue.clear();
  deps = realDeps;
}

export function _setPoliteFetchDepsForTests(overrides: Partial<Deps>): void {
  deps = { ...realDeps, ...overrides };
}

/** Deterministic 32-bit FNV-1a; the jitter offset is `hash % JITTER_BAND_MS`. */
export function jitterFor(sourceId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < sourceId.length; i++) {
    h ^= sourceId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % JITTER_BAND_MS;
}

export function spacingFor(sourceId: string, crawlDelaySeconds: number | null): number {
  const delay = crawlDelaySeconds !== null ? crawlDelaySeconds * 1000 : 0;
  return Math.max(delay, MIN_SPACING_MS) + jitterFor(sourceId);
}

/** One flight per host: callers queue behind each other, in arrival order. */
async function withHostSlot<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const prev = hostQueue.get(host) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.then(() => gate);
  hostQueue.set(host, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (hostQueue.get(host) === chained) hostQueue.delete(host);
  }
}

async function waitForHost(host: string): Promise<void> {
  const until = nextAllowedAt.get(host) ?? 0;
  const wait = until - deps.now();
  if (wait > 0) await deps.sleep(wait);
}

function stampHost(host: string, sourceId: string, crawlDelaySeconds: number | null): void {
  nextAllowedAt.set(host, deps.now() + spacingFor(sourceId, crawlDelaySeconds));
}

/** RFC 9309 §2.5: a crawler parses at least 500 KiB of robots.txt; what is past the cap is dropped, not failed. */
export const MAX_ROBOTS_BYTES = 512 * 1024;

/** Where robots.txt ends up after at most MAX_REDIRECTS hops, each target vetted by the
 *  caller's hopGuard BEFORE it is requested (a public host 302-ing its robots.txt onto a
 *  metadata address must not become a request to it). `null` = no policy readable. */
async function fetchRobots(origin: URL, hopGuard: PoliteFetchOptions["hopGuard"]): Promise<Response | null> {
  let current = new URL(`${origin.protocol}//${origin.host}/robots.txt`);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await deps.fetch(current.href, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": USER_AGENT, accept: "text/plain,*/*;q=0.5" },
    });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get("location");
    await res.body?.cancel().catch(() => undefined);
    if (!location || hop === MAX_REDIRECTS) return null;
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return null; /* an unparseable Location: the host published no readable policy */
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") return null;
    if (hopGuard && (await hopGuard(next))) return null;
    current = next;
  }
  return null;
}

async function robotsFor(origin: URL, hopGuard: PoliteFetchOptions["hopGuard"]): Promise<RobotsEntry> {
  const host = origin.host;
  const cached = robotsCache.get(host);
  const now = deps.now();
  if (cached && now - cached.fetchedAt < cached.ttlMs) return cached;
  let entry: RobotsEntry;
  try {
    const res = await fetchRobots(origin, hopGuard);
    if (!res) {
      // A redirect chain that is refused, too long or malformed: no policy we may read.
      entry = { fetchedAt: now, ttlMs: ROBOTS_TTL_MS, rules: null, outage: false };
    } else if (res.status >= 500) {
      await res.body?.cancel().catch(() => undefined);
      entry = { fetchedAt: now, ttlMs: ROBOTS_OUTAGE_TTL_MS, rules: null, outage: true };
    } else if (res.ok) {
      const text = await readCapped(res, MAX_ROBOTS_BYTES);
      entry = { fetchedAt: now, ttlMs: ROBOTS_TTL_MS, rules: parseRobots(text), outage: false };
    } else {
      // 404/403/other 4xx: the host publishes no policy for us — allow (RFC 9309 §2.3.1.3).
      await res.body?.cancel().catch(() => undefined);
      entry = { fetchedAt: now, ttlMs: ROBOTS_TTL_MS, rules: null, outage: false };
    }
  } catch (error) {
    // Unreachable robots.txt = allow, said once per host so a log is not flooded per page.
    if (!robotsWarned.has(host)) {
      robotsWarned.add(host);
      console.warn(`[jobseeker:politeFetch] robots.txt unreachable for ${host}; proceeding as allowed`, error instanceof Error ? error.message : error);
    }
    entry = { fetchedAt: now, ttlMs: ROBOTS_TTL_MS, rules: null, outage: false };
  }
  robotsCache.set(host, entry);
  return entry;
}

/** The first `max` bytes of a body, decoded; the rest is never pulled off the wire. */
async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, max);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const room = max - total;
    chunks.push(value.byteLength > room ? value.subarray(0, room) : value);
    total += Math.min(value.byteLength, room);
    if (total >= max) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

function looksLikeInterstitial(contentType: string, body: string): boolean {
  if (!contentType.includes("text/html")) return false;
  const head = body.slice(0, 64 * 1024);
  return INTERSTITIAL_SIGNATURES.some((sig) => head.includes(sig));
}

async function readBounded(res: Response): Promise<{ text: string } | { tooLarge: true }> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    return { tooLarge: true };
  }
  if (!res.body) return { text: await res.text() };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return { text: new TextDecoder("utf-8").decode(merged) };
}

/** A streamed body that stalled or overran its deadline. Its `name` is "TimeoutError",
 *  the same as undici's own timeout, so a consumer checks one name for both. */
export class StreamTimeout extends Error {
  readonly which: "idle" | "total";
  constructor(which: "idle" | "total") {
    super(which === "idle" ? `stream idle for ${STREAM_IDLE_TIMEOUT_MS} ms` : `stream still open after ${STREAM_TOTAL_TIMEOUT_MS} ms`);
    this.name = "TimeoutError";
    this.which = which;
  }
}

/** `body` behind the two stream deadlines: an idle gap between upstream chunks and a
 *  total time since the headers. A deadline cancels the upstream body, aborts the
 *  request, and errors the stream the consumer holds - a read waiting on a stalled
 *  socket rejects instead of hanging the scan. */
function withStreamDeadlines(body: ReadableStream<Uint8Array>, abort: (reason: unknown) => void): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  let failed = false;
  const clear = () => {
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
  };
  const fail = (controller: ReadableStreamDefaultController<Uint8Array>, error: StreamTimeout) => {
    if (failed) return;
    failed = true;
    clear();
    reader.cancel(error).catch(() => undefined);
    abort(error);
    controller.error(error);
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      totalTimer = setTimeout(() => fail(controller, new StreamTimeout("total")), STREAM_TOTAL_TIMEOUT_MS);
    },
    async pull(controller) {
      idleTimer = setTimeout(() => fail(controller, new StreamTimeout("idle")), STREAM_IDLE_TIMEOUT_MS);
      try {
        const { done, value } = await reader.read();
        clearTimeout(idleTimer);
        if (failed) return;
        if (done) {
          clear();
          controller.close();
        } else if (value) controller.enqueue(value);
      } catch (error) {
        clearTimeout(idleTimer);
        if (failed) return;
        clear();
        controller.error(error);
      }
    },
    cancel(reason) {
      clear();
      return reader.cancel(reason);
    },
  });
}

function classifyStatus(status: number): FetchFailure | null {
  if (status === 401 || status === 403 || status === 429) return { kind: "blocked", status, detail: `http_${status}` };
  if (status === 404 || status === 410) return { kind: "gone", status, detail: `http_${status}` };
  if (status >= 500) return { kind: "outage", status, detail: `http_${status}` };
  if (status >= 400) return { kind: "outage", status, detail: `http_${status}` };
  return null;
}

export const politeFetch: PoliteFetch = async function politeFetch(url, opts): Promise<FetchOutcome> {
  if (isOffline()) return { kind: "offline", detail: "KP_OFFLINE" };
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { kind: "outage", detail: "bad_url" };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return { kind: "outage", detail: "bad_scheme" };

  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept: opts.accept ?? DEFAULT_ACCEPT,
  };
  if (opts.acceptLanguage) headers["accept-language"] = opts.acceptLanguage;
  if (opts.contentType) headers["content-type"] = opts.contentType;

  // Redirects are followed by hand so a hop onto ANOTHER host re-runs the robots check
  // and the spacing for that host before a byte of it is requested.
  let current = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const politenessHost = hop === 0 && opts.host ? opts.host : current.host;
    const outcome = await withHostSlot(politenessHost, async (): Promise<FetchOutcome | { redirect: URL }> => {
      const robots = await robotsFor(current, opts.hopGuard);
      if (robots.outage) return { kind: "outage", status: 503, detail: "robots_5xx" };
      if (robots.rules && !isPathAllowed(robots.rules, `${current.pathname}${current.search}`)) {
        return { kind: "robots_disallowed", detail: `${current.pathname} disallowed for ${CRAWLER_TOKEN}` };
      }
      const crawlDelay = robots.rules ? crawlDelayFor(robots.rules) : null;
      await waitForHost(politenessHost);
      // The request's one controller. The header timer aborts it for a buffered request
      // (headers AND body); in stream mode the timer is cleared once the headers arrive
      // and the body deadlines (withStreamDeadlines) abort it instead.
      const controller = new AbortController();
      const headerTimer = setTimeout(() => controller.abort(new DOMException("fetch timeout", "TimeoutError")), FETCH_TIMEOUT_MS);
      const exchange = async (): Promise<FetchOutcome | { redirect: URL }> => {
        let res: Response;
        try {
          const hopHeaders = opts.authorization && current.host === target.host ? { ...headers, authorization: opts.authorization } : headers;
          res = await deps.fetch(current.href, {
            method,
            body: method === "POST" ? opts.body : undefined,
            headers: hopHeaders,
            redirect: "manual",
            signal: controller.signal,
          });
        } catch (error) {
          stampHost(politenessHost, opts.sourceId, crawlDelay);
          const message = error instanceof Error ? error.message : String(error);
          return { kind: "outage", detail: /timeout|abort/i.test(message) ? "timeout" : "network" };
        } finally {
          stampHost(politenessHost, opts.sourceId, crawlDelay);
        }
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          await res.body?.cancel().catch(() => undefined);
          if (!location) return { kind: "outage", status: res.status, detail: "redirect_without_location" };
          try {
            return { redirect: new URL(location, current) };
          } catch {
            return { kind: "outage", status: res.status, detail: "bad_redirect" };
          }
        }
        const failure = classifyStatus(res.status);
        if (failure) {
          await res.body?.cancel().catch(() => undefined);
          return failure;
        }
        const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
        if (opts.stream) {
          // Headers are here: the 15 s bound would otherwise kill a 184 MB body mid-read.
          clearTimeout(headerTimer);
          const stream = res.body ? withStreamDeadlines(res.body, (reason) => controller.abort(reason)) : null;
          return { kind: "ok", status: res.status, contentType, body: "", finalUrl: res.url || current.href, stream };
        }
        if (method === "HEAD") {
          await res.body?.cancel().catch(() => undefined);
          return { kind: "ok", status: res.status, contentType, body: "", finalUrl: current.href, stream: null };
        }
        const read = await readBounded(res);
        if ("tooLarge" in read) return { kind: "outage", status: res.status, detail: "too_large" };
        if (looksLikeInterstitial(contentType, read.text)) return { kind: "blocked", status: res.status, detail: "interstitial" };
        return { kind: "ok", status: res.status, contentType, body: read.text, finalUrl: current.href, stream: null };
      };
      try {
        return await exchange();
      } finally {
        clearTimeout(headerTimer);
      }
    });
    if ("redirect" in outcome) {
      if (hop === MAX_REDIRECTS) return { kind: "outage", detail: "too_many_redirects" };
      if (outcome.redirect.protocol !== "http:" && outcome.redirect.protocol !== "https:") return { kind: "outage", detail: "bad_scheme" };
      if (opts.hopGuard) {
        const refused = await opts.hopGuard(outcome.redirect);
        if (refused) return { kind: "blocked", detail: `redirect_refused:${refused}` };
      }
      current = outcome.redirect;
      continue;
    }
    return outcome;
  }
  return { kind: "outage", detail: "too_many_redirects" };
};
