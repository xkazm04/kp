// The one dispatch door. Hosts never call an adapter directly: createTts()
// binds adapters to the host, enforces the validation door on every request,
// resolves the preferred provider against live probes (fallback visible, never
// silent), and serializes the local sidecars (a one-shot process reloads a
// model per call; two at once doubles the time and halves the memory).
import { ElevenLabsTts } from "./providers/elevenlabs.ts";
import { KokoroTts } from "./providers/kokoro.ts";
import { PiperTts } from "./providers/piper.ts";
import { primaryLanguage, validateRequest } from "./validate.ts";
import { segmentSpeech } from "./text/segment.ts";
import { concatWav } from "./node/wav.ts";
import {
  isTtsProviderId,
  TTS_PROVIDER_IDS,
  TtsError,
  type TtsAudio,
  type TtsHost,
  type TtsPreference,
  type TtsProvider,
  type TtsProviderId,
  type TtsRequest,
  type TtsResolution,
  type TtsStatus,
  type ServedTtsAudio,
} from "./types.ts";

export type { TtsStatus } from "./types.ts";

export type Tts = {
  readonly ids: readonly TtsProviderId[];
  readonly preference: TtsPreference;
  get(id: TtsProviderId): TtsProvider;
  status(): Promise<TtsStatus[]>;
  /** Pick the provider that will serve: the requested one if allowed+ready AND
   *  declaring the requested language, else the preferred, else the first
   *  allowed+ready. A ready engine that does not declare the language still
   *  serves when nothing better can, with `unsupportedLanguage` set — silence is
   *  worse than an accent, a SILENT accent is worse than both. Throws
   *  `unavailable` when nothing can speak — the host's degraded terminal state
   *  is text. */
  resolve(requested?: unknown, language?: string | null): Promise<TtsResolution>;
  speak(req: TtsRequest, opts?: { provider?: unknown; signal?: AbortSignal }): Promise<ServedTtsAudio>;
};

export function defaultProviders(host: TtsHost): TtsProvider[] {
  return [new ElevenLabsTts(host), new PiperTts(host), new KokoroTts(host)];
}

/** Read the host's preference from two variables it names: the preferred id and
 *  a comma list of ids the UI may offer. Unknown ids are dropped, not thrown —
 *  a stored preference pointing at a retired provider normalizes on read. */
export function preferenceFromEnv(host: TtsHost, vars: { preferred: string; allowed: string }): TtsPreference {
  const preferredRaw = host.env(vars.preferred)?.trim().toLowerCase() || null;
  const preferred = isTtsProviderId(preferredRaw) ? preferredRaw : null;
  const allowedRaw = (host.env(vars.allowed) || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const allowed = allowedRaw.length ? allowedRaw.filter(isTtsProviderId) : preferred ? [preferred] : [...TTS_PROVIDER_IDS];
  return { preferred, allowed: preferred && !allowed.includes(preferred) ? [preferred, ...allowed] : allowed };
}

export function createTts(opts: { host: TtsHost; providers?: TtsProvider[]; preference?: TtsPreference }): Tts {
  const providers = opts.providers ?? defaultProviders(opts.host);
  const byId = new Map<TtsProviderId, TtsProvider>(providers.map((p) => [p.id, p]));
  const preference: TtsPreference = opts.preference ?? { preferred: null, allowed: providers.map((p) => p.id) };
  const allowed = preference.allowed.filter((id) => byId.has(id));
  // One local synthesis at a time per process (see header).
  let localQueue: Promise<unknown> = Promise.resolve();

  const get = (id: TtsProviderId) => {
    const p = byId.get(id);
    if (!p) throw new TtsError("unavailable", `provider ${id} is not registered`);
    return p;
  };

  /** Does this adapter CLAIM the requested primary language? "any" is the
   *  multilingual engines' declaration (they pick a voice per language), and a
   *  null request asks for nothing, so both are a yes. */
  const speaks = (provider: TtsProvider, lang: string | null): boolean =>
    !lang || provider.capabilities.languages === "any" || provider.capabilities.languages.includes(lang);

  const resolve = async (requested?: unknown, language?: string | null): Promise<TtsResolution> => {
    const order: TtsProviderId[] = [];
    const push = (id: TtsProviderId | null | undefined) => id && allowed.includes(id) && !order.includes(id) && order.push(id);
    push(isTtsProviderId(requested) ? requested : null);
    push(preference.preferred);
    allowed.forEach(push);
    const asked = order[0] ?? null;
    const lang = primaryLanguage(typeof language === "string" ? language : null);
    let lastReason = "no provider is allowed";
    // THE DECLARED LANGUAGE IS PART OF READINESS. Probe state alone used to
    // decide, so a Czech request that landed on Kokoro (which declares no `cs`)
    // was read out in English: no error, no fallback, nothing logged. A ready
    // engine that DECLARES the language wins over one that does not, whatever
    // the order says — and each provider is still probed at most once.
    let spokenElsewhere: { id: TtsProviderId; reason: string } | null = null;
    for (const id of order) {
      const provider = get(id);
      const probe = await provider.probe();
      if (probe.state !== "ready") {
        lastReason = `${id}: ${probe.reason}`;
        continue;
      }
      if (speaks(provider, lang)) {
        const fallbackFrom = asked && asked !== id ? asked : null;
        if (fallbackFrom) opts.host.log?.({ type: "fallback", from: fallbackFrom, to: id, reason: lastReason });
        return { provider, fallbackFrom, reason: fallbackFrom ? lastReason : null, unsupportedLanguage: null };
      }
      // Remember the FIRST ready one that cannot: silence is worse than an
      // accent, so it serves if nothing better turns up — but it says so.
      spokenElsewhere ??= { id, reason: lastReason };
      lastReason = `${id}: does not speak ${lang}`;
    }
    if (spokenElsewhere) {
      const { id } = spokenElsewhere;
      const reason = `no ready provider declares ${lang}`;
      opts.host.log?.({ type: "language_fallback", provider: id, requested: lang as string, reason });
      const fallbackFrom = asked && asked !== id ? asked : null;
      if (fallbackFrom) opts.host.log?.({ type: "fallback", from: fallbackFrom, to: id, reason });
      return { provider: get(id), fallbackFrom, reason, unsupportedLanguage: lang };
    }
    throw new TtsError("unavailable", lastReason);
  };

  return {
    ids: providers.map((p) => p.id),
    preference: { preferred: preference.preferred, allowed },
    get,
    async status() {
      return Promise.all(
        providers.map(async (p) => ({
          id: p.id,
          label: p.label,
          kind: p.kind,
          capabilities: p.capabilities,
          probe: await p.probe(),
          allowed: allowed.includes(p.id),
          preferred: preference.preferred === p.id,
        })),
      );
    },
    resolve,
    async speak(raw, o) {
      // Validated BEFORE the pick: the validated request is what carries the
      // normalised language, and the language is now part of the pick.
      const req = validateRequest(raw);
      const { provider, fallbackFrom, unsupportedLanguage } = await resolve(o?.provider, req.language);
      // Above the engine's clip cap, synthesize sentence chunks and join them —
      // the whole-clip host still gets one clip, and a streaming host calls
      // speak() per chunk itself (see react/useTts).
      const cap = provider.capabilities.maxClipChars;
      const parts = req.text.length > cap ? segmentSpeech(req.text, { maxChars: cap, firstChunkClause: false }) : [req.text];
      const run = async (): Promise<TtsAudio> => {
        const clips: TtsAudio[] = [];
        for (const text of parts) clips.push(await provider.synthesize({ ...req, text }, o?.signal));
        if (clips.length === 1) return clips[0];
        if (clips.some((c) => c.mimeType !== "audio/wav")) throw new TtsError("engine_failed", "cannot join non-WAV segments", provider.id);
        return {
          bytes: concatWav(clips.map((c) => c.bytes), provider.id),
          mimeType: "audio/wav",
          provider: provider.id,
          voiceId: clips[0].voiceId,
          elapsedMs: clips.reduce((n, c) => n + c.elapsedMs, 0),
          segments: clips.length,
        };
      };
      let audio: TtsAudio;
      if (provider.kind === "local") {
        // One local synthesis at a time per process: a CPU budget choice (two
        // jobs each run at half speed), not a correctness rule — a persistent
        // engine worker would lift it.
        const turn = localQueue.then(run, run);
        localQueue = turn.catch(() => {});
        audio = await turn;
      } else audio = await run();
      return { ...audio, fallbackFrom, unsupportedLanguage };
    },
  };
}
