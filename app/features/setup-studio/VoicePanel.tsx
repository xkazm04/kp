"use client";

/*
 * The voice phase: audition what is installed, pick a default, or skip.
 *
 * Every fact here comes through the installer, which RELAYS the app's own
 * `GET /api/tts` (the page cannot reach the booted app cross-origin itself). So
 * three honest states are rendered, never two: `ready` is green, `broken` is a
 * failure worth naming, and `absent` is neither — it means "you never installed
 * this one", and painting it the same red as broken would invent a problem.
 *
 * The skip is ALWAYS visible, including on every failure path. The agent waits
 * on `POST /choice/tts` before it prints the matrix (PROTOCOL.md, "App + voice
 * proxy"), so a voice panel with no way out is not a cosmetic gap — it is a run
 * that never finishes.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Volume2 } from "lucide-react";
import { Badge } from "@/app/_components/Badge";
import { Skeleton } from "@/app/_components/Skeleton";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD_PAD, NOTICE, PANEL } from "@/app/_components/ui/recipes";
import { normalizeTts, type TtsPayload, type TtsProvider } from "./protocol";
import { COPY } from "./copy";
import type { WizardClient } from "./useWizardSession";

type Load =
  | { phase: "loading" }
  | { phase: "ready"; payload: TtsPayload }
  | { phase: "locked" }
  | { phase: "error"; detail: string };

function ProviderCard({
  provider,
  preferred,
  chosen,
  onChoose,
  onPlay,
}: {
  provider: TtsProvider;
  preferred: string | null;
  chosen: string | null;
  onChoose: () => void;
  onPlay: (voiceId: string | null) => Promise<string | null>;
}) {
  const [voiceId, setVoiceId] = useState(provider.voices[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const isChosen = chosen === provider.id;

  return (
    <div
      className={`${PANEL} p-4 ${isChosen ? "border-moss/50" : ""}`}
      data-provider={provider.id}
      data-state={provider.ready ? "ready" : provider.state}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-base font-semibold text-ink">{provider.name}</span>
        <Badge
          tone={provider.ready ? "positive" : provider.state === "broken" ? "critical" : "neutral"}
          label={provider.ready ? "ready" : provider.state}
          muted={!provider.ready && provider.state !== "broken"}
        />
      </div>
      {provider.languages ? (
        <p className="mt-1 text-sm text-steel">
          {COPY.voiceSpeaks} {provider.languages}
        </p>
      ) : null}
      {provider.reason ? <p className="mt-1 text-sm text-steel">{provider.reason}</p> : null}
      {preferred === provider.id && !isChosen ? (
        <p className="mt-1 text-sm text-moss">{COPY.voiceCurrent}</p>
      ) : null}
      {isChosen ? <p className="mt-1 text-sm font-semibold text-moss">{COPY.voiceChosen}</p> : null}
      {problem ? <p className="mt-1 text-sm text-coral">{problem}</p> : null}

      {provider.ready ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {provider.voices.length > 1 ? (
            <select
              value={voiceId}
              aria-label={`Voice for ${provider.name}`}
              onChange={(e) => setVoiceId(e.target.value)}
              className="h-9 rounded-md border border-stone-200 bg-white px-2 text-sm text-ink"
            >
              {provider.voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.language ? ` · ${v.language}` : ""}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setProblem(await onPlay(voiceId || null));
              setBusy(false);
            }}
            className={`${BTN_SECONDARY} h-9 px-3`}
          >
            <Play size={14} aria-hidden />
            {COPY.voicePlay}
          </button>
          <button type="button" onClick={onChoose} className={`${BTN_PRIMARY} h-9 px-3`}>
            {COPY.voiceDefault}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function VoicePanel({
  client,
  onChose,
  onSkipped,
}: {
  client: WizardClient;
  onChose: (provider: TtsProvider) => void;
  onSkipped: () => void;
}) {
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [chosen, setChosen] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);
  // One Audio element per panel, so a second Play interrupts the first rather
  // than talking over it — and so the object URL is always revoked.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await client.getJSON("/app/tts");
        if (!live) return;
        // A 401 is the app's own operator gate answering through the relay, and
        // PROTOCOL.md passes it through as-is rather than smoothing it over. It
        // is the auth working, not a fault, and the copy says so.
        if (res.status === 401) setLoad({ phase: "locked" });
        else if (!res.ok || res.json === null) setLoad({ phase: "error", detail: `The app answered ${res.status}.` });
        else setLoad({ phase: "ready", payload: normalizeTts(res.json) });
      } catch (err) {
        if (live) setLoad({ phase: "error", detail: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      live = false;
    };
  }, [client]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  /** Returns a problem to render on the card, or null when it spoke. */
  const play = useCallback(
    async (provider: TtsProvider, voiceId: string | null): Promise<string | null> => {
      try {
        // The host picks the sentence — the page never sends text, which is how
        // a "listen to this" button cannot become a way to spend tokens.
        const res = await client.postBlob("/app/tts/sample", {
          provider: provider.id,
          voiceId: voiceId ?? undefined,
          language: "en",
        });
        if (!res.ok) return `Sample failed (${res.status}).`;
        // The host says which engine actually spoke. When it had to fall back,
        // that is exactly the fact a "pick your default" screen must not hide.
        const spoke = res.headers.get("x-tts-provider");
        const fellBack = res.headers.get("x-tts-fallback-from");
        const blob = await res.blob();
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        audioRef.current?.pause();
        const audio = new Audio(url);
        audioRef.current = audio;
        await audio.play();
        if (fellBack && spoke && spoke !== provider.id) {
          return `That sample was spoken by ${spoke}, not ${provider.id} — it fell back.`;
        }
        return null;
      } catch (err) {
        return `Could not play it: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    [client],
  );

  const skip = (
    <button
      type="button"
      disabled={skipped}
      onClick={() => {
        setSkipped(true);
        onSkipped();
      }}
      className={`${BTN_GHOST} mt-4 h-10 px-3`}
    >
      {skipped ? COPY.voiceSkipped : COPY.voiceSkip}
    </button>
  );

  return (
    <section className={`${PANEL} ${CARD_PAD}`}>
      <h2 className="flex items-center gap-2 font-serif text-h2 text-ink">
        <Volume2 size={18} aria-hidden className="text-coral" />
        {COPY.voiceTitle}
      </h2>

      {load.phase === "loading" ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-steel">{COPY.voiceLoading}</p>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : null}

      {load.phase === "locked" ? <p className="mt-2 text-body text-steel">{COPY.voice401}</p> : null}

      {load.phase === "error" ? (
        <p role="status" className={`${NOTICE("amber")} mt-3 px-3 py-2 text-sm`}>
          {load.detail}
        </p>
      ) : null}

      {load.phase === "ready" ? (
        <>
          <p className="mt-1 text-body text-steel">{COPY.voiceNote}</p>
          {load.payload.allowed ? (
            <p className="mt-1 text-sm text-steel">
              {COPY.voiceLocked} {load.payload.allowed.join(", ")}
            </p>
          ) : null}
          {load.payload.providers.length === 0 ? (
            <p className="mt-3 text-body text-steel">{COPY.voiceNone}</p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {load.payload.providers.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  preferred={load.payload.preferred}
                  chosen={chosen}
                  onChoose={() => {
                    setChosen(provider.id);
                    onChose(provider);
                  }}
                  onPlay={(voiceId) => play(provider, voiceId)}
                />
              ))}
            </div>
          )}
        </>
      ) : null}

      {skip}
    </section>
  );
}
