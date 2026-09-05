"use client";
// Headless browser side. Talks to whatever route the host mounts the package
// behind (see README "Host wrapper"): POST {text, language, provider?, voiceId?}
// -> audio bytes, with X-Tts-Provider / X-Tts-Voice / X-Tts-Fallback-From headers.
//
// Time-to-first-audio is won HERE, with no transport change: the utterance is
// normalized (chat markup stripped), segmented at sentence boundaries, and
// chunk N plays while chunk N+1 is fetched (two ahead). One utterance audible
// at a time, stop means now (generation token + abort + element release), a
// blocked autoplay surfaces as `blocked`, and a mid-utterance failure is a
// TRUNCATION the surface can show ("stopped after 2 of 5"), never silence.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TtsProviderId, TtsStatus } from "../types.ts";
import { speechReady } from "../text/normalize.ts";
import { segmentSpeech } from "../text/segment.ts";

/** `waiting` is a THROTTLE, not a failure: the host (or the engine behind it)
 *  asked us to hold for a stated number of seconds, and the utterance is still
 *  going to finish. It is its own member rather than a flavour of
 *  `synthesizing` because the surface has something different to say - "still
 *  working" invites waiting, "the engine asked us to wait 2s" explains why. */
export type TtsPlayback = "idle" | "synthesizing" | "waiting" | "playing" | "blocked" | "error";

/** A refusal the HOST ROUTE coded.
 *
 *  `message` is the route's canonical English, kept because a non-kp host may
 *  have nothing else; `code` is the machine name a localizing host resolves in
 *  the reader's language. Both, rather than either: a package that threw only a
 *  sentence forced every surface to paint English, and one that threw only a
 *  code would break the hosts that print `error` today. */
export class TtsRequestError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "TtsRequestError";
  }
}

/** What a non-2xx answer from the host route MEANS. Pure and exported so the
 *  contract can be pinned without a DOM: a body with no code (a proxy's HTML
 *  error page, a truncated response) still yields a usable sentence, and a
 *  falsy `error` never wins over the status line. */
export function ttsErrorFrom(body: { error?: string; code?: string | null } | null | undefined, status: number): TtsRequestError {
  return new TtsRequestError(body?.error || `status ${status}`, body?.code ?? null);
}

/** How many EXTRA attempts one chunk gets after a throttled answer. Two, so a
 *  brief window closing mid-utterance is survived, and a service that is simply
 *  out of budget is answered rather than hammered. */
export const TTS_RETRY_ATTEMPTS = 2;
/** The longest wait an utterance will hold for. Past this the operator is told
 *  it stopped: a held Play button that resumes a minute later is a surface that
 *  looks broken while it is behaving. */
export const TTS_RETRY_MAX_WAIT_MS = 10_000;

/** The wait we will actually honor from a `Retry-After`, or null for "do not
 *  retry".
 *
 *  Both RFC forms: delta-seconds and an HTTP-date. Null is returned for a header
 *  that is absent or unreadable and for one asking LONGER than the ceiling - in
 *  both cases inventing a wait is the failure mode. Waiting less than the
 *  service asked for is hammering it, and a fabricated wait after no header at
 *  all is the client-side twin of the fabricated `Retry-After` the route
 *  deliberately does not send (app/api/tts/route.ts, `engineThrottled`). A
 *  window that has already opened is 0, which is a retry, not a refusal. */
export function retryWaitMs(header: string | null | undefined, now: number = Date.now()): number | null {
  const raw = typeof header === "string" ? header.trim() : "";
  if (!raw) return null;
  // A value that STARTS like a number but is not delta-seconds ("-5", "2.5") is
  // malformed, not a date: Date.parse("-5") happily yields the year 2001, which
  // would have turned a broken header into "retry now".
  if (/^[-+.0-9]/.test(raw) && !/^[0-9]+$/.test(raw)) return null;
  const ms = /^[0-9]+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now;
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return 0;
  return ms > TTS_RETRY_MAX_WAIT_MS ? null : ms;
}

function abortError(): Error {
  // The name is the contract: `speak` treats an AbortError as "superseded", not
  // as a failure to paint, and so does every fetch this package makes.
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

/** setTimeout that ends the moment the generation is stopped. A wait that
 *  outlived its utterance would resume a request the operator already cancelled. */
function sleepUntil(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** One request, retried while the answer is a 429 that named a wait we can hold.
 *
 *  Pure and exported so the decision is pinned without a DOM. It hands the LAST
 *  response back rather than throwing: the caller already knows how to turn a
 *  non-2xx into a coded `TtsRequestError`, and a retry loop that invented its own
 *  error type would be a second vocabulary for the same refusal. */
export async function fetchHonoringRetryAfter(
  attempt: () => Promise<Response>,
  signal: AbortSignal,
  hooks: {
    onWait?: (ms: number) => void;
    onResume?: () => void;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  } = {},
): Promise<Response> {
  const wait = hooks.sleep ?? sleepUntil;
  for (let left = TTS_RETRY_ATTEMPTS; ; left -= 1) {
    const res = await attempt();
    if (res.status !== 429 || left === 0) return res;
    const ms = retryWaitMs(res.headers.get("retry-after"));
    if (ms === null) return res;
    hooks.onWait?.(ms);
    try {
      await wait(ms, signal);
    } finally {
      hooks.onResume?.();
    }
  }
}

export type UseTtsOptions = {
  /** The host route, e.g. "/api/tts". GET returns { providers: TtsStatus[] }. */
  endpoint: string;
  /** Fetch wrapper if the host needs credentials/headers. */
  fetcher?: typeof fetch;
  /** Longest chunk sent per request; lower = faster first audio, choppier prosody. */
  maxChunkChars?: number;
  /** How many chunks to fetch ahead of playback. */
  lookahead?: number;
};

export type SpeakArgs = {
  text: string;
  language?: string | null;
  provider?: TtsProviderId | null;
  voiceId?: string | null;
  speed?: number | null;
  /** "chat" strips markdown/code/links/emoji before speaking. */
  format?: "plain" | "chat" | null;
  /** false = one request for the whole text (no pipelining). */
  segment?: boolean;
};

export type TtsServed = {
  provider: TtsProviderId;
  fallbackFrom: TtsProviderId | null;
  elapsedMs: number;
  firstAudioMs: number;
  /** The voice the engine actually used (`X-Tts-Voice`), which is NOT always
   *  the one asked for — a null request takes the engine's default, and a
   *  fallback provider ignores the other engine's voice ids entirely. Null when
   *  the host does not send the header. */
  voiceId?: string | null;
};

export type UseTts = {
  providers: TtsStatus[] | null;
  refreshProviders: () => Promise<void>;
  playback: TtsPlayback;
  /** The provider that served the utterance, where it fell back from, synthesis
   *  time of the first chunk and wall time to the first audible sample. */
  served: TtsServed | null;
  /** Chunks spoken so far / total for the current utterance. */
  progress: { spoken: number; total: number } | null;
  error: string | null;
  /** The host route's machine code for that same failure, when it sent one
   *  (`TTS_FAILED`, `TOO_MANY_REQUESTS`, `VOICE_REQUEST_INVALID`). Null for a
   *  transport error, a playback fault, or a host that answers no code. A
   *  localizing surface resolves THIS and keeps `error` for its log. */
  errorCode: string | null;
  speak: (args: SpeakArgs) => Promise<void>;
  /** Resume a playback the browser blocked (must be called from a user gesture). */
  resume: () => Promise<void>;
  stop: () => void;
};

type Chunk = { url: string; provider: TtsProviderId; fallbackFrom: TtsProviderId | null; elapsedMs: number; voiceId: string | null };

export function useTts({ endpoint, fetcher, maxChunkChars = 280, lookahead = 2 }: UseTtsOptions): UseTts {
  const f = useMemo(() => fetcher ?? ((...a: Parameters<typeof fetch>) => fetch(...a)), [fetcher]);
  const [providers, setProviders] = useState<TtsStatus[] | null>(null);
  const [playback, setPlayback] = useState<TtsPlayback>("idle");
  const [served, setServed] = useState<TtsServed | null>(null);
  const [progress, setProgress] = useState<UseTts["progress"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlsRef = useRef<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const release = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.src = "";
      audioRef.current = null;
    }
    for (const u of urlsRef.current) URL.revokeObjectURL(u);
    urlsRef.current = [];
  }, []);

  const stop = useCallback(() => {
    generation.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    release();
    setPlayback("idle");
  }, [release]);

  useEffect(() => stop, [stop]);

  const refreshProviders = useCallback(async () => {
    try {
      const res = await f(endpoint, { method: "GET" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = (await res.json()) as { providers: TtsStatus[] };
      setProviders(json.providers);
    } catch (e) {
      setProviders([]);
      setError((e as Error).message);
      // A probe that could not be read carries no route code: the failure is the
      // fetch, not a refusal the host named.
      setErrorCode(null);
    }
  }, [endpoint, f]);

  const fetchChunk = useCallback(
    async (text: string, args: SpeakArgs, signal: AbortSignal): Promise<Chunk> => {
      // A throttled chunk is HELD, not dropped: a 429 on chunk 3 of 6 used to
      // truncate the utterance mid-sentence, and the immediate manual retry the
      // operator made hit the same closed window. The wait is the one the host
      // asked for, bounded, and it ends the instant the utterance is stopped.
      const res = await fetchHonoringRetryAfter(
        () =>
          f(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              text,
              language: args.language,
              provider: args.provider,
              voiceId: args.voiceId,
              speed: args.speed,
            }),
            signal,
          }),
        signal,
        {
          // A chunk being FETCHED AHEAD while an earlier one plays must not
          // relabel the surface: the operator is hearing audio, and "waiting" over
          // a playing utterance is a control that lies. Only a wait we are
          // actually blocked on is shown.
          onWait: () => setPlayback((p) => (p === "playing" ? p : "waiting")),
          onResume: () => setPlayback((p) => (p === "waiting" ? "synthesizing" : p)),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        throw ttsErrorFrom(body, res.status);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      urlsRef.current.push(url);
      return {
        url,
        provider: (res.headers.get("x-tts-provider") || "unknown") as TtsProviderId,
        fallbackFrom: (res.headers.get("x-tts-fallback-from") as TtsProviderId | null) || null,
        elapsedMs: Number(res.headers.get("x-tts-elapsed-ms") || 0),
        voiceId: res.headers.get("x-tts-voice") || null,
      };
    },
    [endpoint, f],
  );

  /** Play one clip to completion; resolves "done" | "blocked" (element kept for resume). */
  const playUrl = useCallback(
    (url: string, gen: number): Promise<"done" | "blocked"> =>
      new Promise((resolve, reject) => {
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => resolve("done");
        audio.onerror = () => reject(new Error("playback failed"));
        audio.play().then(
          () => {
            if (gen === generation.current) setPlayback("playing");
          },
          () => resolve("blocked"),
        );
      }),
    [],
  );

  const speak = useCallback(
    async (args: SpeakArgs) => {
      stop();
      const gen = generation.current;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setError(null);
      setErrorCode(null);
      setServed(null);
      const text = args.format === "chat" ? speechReady(args.text) : args.text;
      const chunks = args.segment === false ? [text] : segmentSpeech(text, { maxChars: maxChunkChars });
      if (!chunks.length) return;
      setProgress({ spoken: 0, total: chunks.length });
      setPlayback("synthesizing");
      const started = performance.now();
      const pending: Promise<Chunk>[] = [];
      const ensure = (i: number) => {
        while (pending.length < chunks.length && pending.length <= i + lookahead) {
          const k = pending.length;
          pending.push(fetchChunk(chunks[k], args, ctrl.signal));
          pending[k].catch(() => {});
        }
      };
      try {
        for (let i = 0; i < chunks.length; i++) {
          ensure(i);
          const chunk = await pending[i];
          if (gen !== generation.current) return;
          if (i === 0) {
            setServed({ provider: chunk.provider, fallbackFrom: chunk.fallbackFrom, elapsedMs: chunk.elapsedMs, firstAudioMs: Math.round(performance.now() - started), voiceId: chunk.voiceId });
          }
          const result = await playUrl(chunk.url, gen);
          if (gen !== generation.current) return;
          if (result === "blocked") {
            setPlayback("blocked");
            return;
          }
          setProgress({ spoken: i + 1, total: chunks.length });
          if (audioRef.current) {
            audioRef.current.src = "";
            audioRef.current = null;
          }
        }
        release();
        setPlayback("idle");
      } catch (e) {
        if (gen !== generation.current || (e as Error).name === "AbortError") return;
        setError((e as Error).message);
        setErrorCode(e instanceof TtsRequestError ? e.code : null);
        setPlayback("error");
      }
    },
    [fetchChunk, lookahead, maxChunkChars, playUrl, release, stop],
  );

  const resume = useCallback(async () => {
    const a = audioRef.current;
    if (!a) return;
    try {
      await a.play();
      setPlayback("playing");
    } catch {
      setPlayback("blocked");
    }
  }, []);

  return { providers, refreshProviders, playback, served, progress, error, errorCode, speak, resume, stop };
}
