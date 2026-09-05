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

export type TtsPlayback = "idle" | "synthesizing" | "playing" | "blocked" | "error";

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
      const res = await f(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, language: args.language, provider: args.provider, voiceId: args.voiceId, speed: args.speed }),
        signal,
      });
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
