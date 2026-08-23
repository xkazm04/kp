"use client";
// Headless browser side. Talks to whatever route the host mounts the package
// behind (see README "Host wrapper"): POST {text, language, provider?, voiceId?}
// -> audio bytes, with X-Tts-Provider / X-Tts-Fallback-From headers. Owns the
// playback lifecycle: one utterance audible at a time, stop means now, a blocked
// autoplay surfaces as `blocked` (a play affordance, never silent success).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TtsProviderId, TtsStatus } from "../index.ts";

export type TtsPlayback = "idle" | "synthesizing" | "playing" | "blocked" | "error";

export type UseTtsOptions = {
  /** The host route, e.g. "/api/tts". GET returns { providers: TtsStatus[] }. */
  endpoint: string;
  /** Fetch wrapper if the host needs credentials/headers. */
  fetcher?: typeof fetch;
};

export type SpeakArgs = { text: string; language?: string | null; provider?: TtsProviderId | null; voiceId?: string | null; speed?: number | null };

export type UseTts = {
  providers: TtsStatus[] | null;
  refreshProviders: () => Promise<void>;
  playback: TtsPlayback;
  /** The provider that actually served the last utterance, and where it fell back from. */
  served: { provider: TtsProviderId; fallbackFrom: TtsProviderId | null; elapsedMs: number } | null;
  error: string | null;
  speak: (args: SpeakArgs) => Promise<void>;
  /** Resume a playback the browser blocked (must be called from a user gesture). */
  resume: () => Promise<void>;
  stop: () => void;
};

export function useTts({ endpoint, fetcher }: UseTtsOptions): UseTts {
  const f = useMemo(() => fetcher ?? ((...a: Parameters<typeof fetch>) => fetch(...a)), [fetcher]);
  const [providers, setProviders] = useState<TtsStatus[] | null>(null);
  const [playback, setPlayback] = useState<TtsPlayback>("idle");
  const [served, setServed] = useState<UseTts["served"]>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const release = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.src = "";
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
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
    }
  }, [endpoint, f]);

  const speak = useCallback(
    async (args: SpeakArgs) => {
      stop();
      const gen = generation.current;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setError(null);
      setPlayback("synthesizing");
      try {
        const res = await f(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(args),
          signal: ctrl.signal,
        });
        if (gen !== generation.current) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `status ${res.status}`);
        }
        const provider = (res.headers.get("x-tts-provider") || "unknown") as TtsProviderId;
        const fallbackFrom = (res.headers.get("x-tts-fallback-from") as TtsProviderId | null) || null;
        const elapsedMs = Number(res.headers.get("x-tts-elapsed-ms") || 0);
        const blob = await res.blob();
        if (gen !== generation.current) return;
        setServed({ provider, fallbackFrom, elapsedMs });
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          if (gen === generation.current) {
            release();
            setPlayback("idle");
          }
        };
        audio.onerror = () => {
          if (gen === generation.current) {
            setError("playback failed");
            setPlayback("error");
          }
        };
        try {
          await audio.play();
          if (gen === generation.current) setPlayback("playing");
        } catch {
          if (gen === generation.current) setPlayback("blocked");
        }
      } catch (e) {
        if (gen !== generation.current || (e as Error).name === "AbortError") return;
        setError((e as Error).message);
        setPlayback("error");
      }
    },
    [endpoint, f, release, stop],
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

  return { providers, refreshProviders, playback, served, error, speak, resume, stop };
}
