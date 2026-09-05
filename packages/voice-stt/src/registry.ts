// The one dispatch door. Hosts never call an adapter directly: createStt()
// binds adapters to the host, enforces the validation door on every request,
// resolves the serving provider against live probes AND the capabilities the
// request requires (fallback visible, never silent), and serializes the local
// sidecars (a one-shot process reloads its model per call; two at once doubles
// the wall clock and the memory).
//
// The one place this deviates from its synthesis sibling: resolution takes a
// `needs` set. Synthesis can fall back from a fast voice to a slow one and the
// user hears a different voice saying the same words. Transcription cannot fall
// back from a redacting engine to a non-redacting one — the words themselves
// change, and the ones that appear are exactly the ones somebody asked to have
// removed. So an engine that cannot meet the need is not in the order at all,
// and when none can, the answer is a typed refusal naming the missing
// capability rather than a transcript nobody asked for.
import { wavInfo } from "./node/wav.ts";
import { AssemblyAiStt } from "./providers/assemblyai.ts";
import { WhisperCppStt } from "./providers/whisper-cpp.ts";
import { speaksLanguage, validateRequest } from "./validate.ts";
import {
  isSttProviderId,
  STT_PROVIDER_IDS,
  SttError,
  type SttHost,
  type SttModel,
  type SttNeeds,
  type SttPreference,
  type SttProvider,
  type SttProviderId,
  type SttRequest,
  type SttResolution,
  type SttStatus,
  type SttTranscript,
} from "./types.ts";

export type { SttStatus } from "./types.ts";

export type Stt = {
  readonly ids: readonly SttProviderId[];
  readonly preference: SttPreference;
  get(id: SttProviderId): SttProvider;
  status(): Promise<SttStatus[]>;
  /** Pick the provider that will serve: the requested one if allowed, capable
   *  and ready, else the preferred, else the first that is. Throws
   *  `unavailable` when nothing can listen — the host's degraded terminal state
   *  is text, and it must know it arrived there.
   *
   *  `language` is part of the capability gate, not a hint: an engine that does
   *  not declare the tag is out of the order BEFORE anything is probed. A
   *  status surface that omits it gets the old answer, which is why the
   *  parameter is optional — but a surface that is about to transcribe Czech
   *  and asks "who will serve this?" without saying so is asking a different
   *  question from the one transcribe() will answer. */
  resolve(requested?: unknown, needs?: SttNeeds, language?: string | null): Promise<SttResolution>;
  transcribe(
    req: SttRequest,
    opts?: { provider?: unknown; needs?: SttNeeds; signal?: AbortSignal; timeoutMs?: number },
  ): Promise<SttTranscript & { fallbackFrom: SttProviderId | null; requestedProvider: SttProviderId | null }>;
};

export function defaultProviders(host: SttHost): SttProvider[] {
  // Registration order = the default resolution order = on-device first.
  return [new WhisperCppStt(host), new AssemblyAiStt(host)];
}

/** Read the host's preference from two variables it names: the preferred id and
 *  a comma list of ids the UI may offer. Unknown ids are dropped, not thrown —
 *  a stored preference pointing at a retired provider normalizes on read. */
export function preferenceFromEnv(host: SttHost, vars: { preferred: string; allowed: string }): SttPreference {
  const preferredRaw = host.env(vars.preferred)?.trim().toLowerCase() || null;
  const preferred = isSttProviderId(preferredRaw) ? preferredRaw : null;
  const allowedRaw = (host.env(vars.allowed) || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const allowed = allowedRaw.length ? allowedRaw.filter(isSttProviderId) : preferred ? [preferred] : [...STT_PROVIDER_IDS];
  return { preferred, allowed: preferred && !allowed.includes(preferred) ? [preferred, ...allowed] : allowed };
}

/** Why a provider cannot serve this request, or null when it can. Capability
 *  only — readiness is a probe, and probing is expensive enough to do second. */
function capabilityGap(provider: SttProvider, needs: SttNeeds, language: string | null): string | null {
  const caps = provider.capabilities;
  if (needs.onDevice && !caps.onDevice) return "would send the audio off this machine";
  if (needs.diarization && !caps.diarization) return "cannot label speakers";
  if (needs.redaction && !caps.redaction) return "cannot redact PII";
  if (!speaksLanguage(caps.languages, language)) return `does not transcribe ${language}`;
  return null;
}

export function createStt(opts: { host: SttHost; providers?: SttProvider[]; preference?: SttPreference }): Stt {
  const providers = opts.providers ?? defaultProviders(opts.host);
  const byId = new Map<SttProviderId, SttProvider>(providers.map((p) => [p.id, p]));
  const preference: SttPreference = opts.preference ?? { preferred: null, allowed: providers.map((p) => p.id) };
  const allowed = preference.allowed.filter((id) => byId.has(id));
  // One local transcription at a time per process (see header).
  let localQueue: Promise<unknown> = Promise.resolve();

  const get = (id: SttProviderId) => {
    const p = byId.get(id);
    if (!p) throw new SttError("unavailable", `provider ${id} is not registered`);
    return p;
  };

  const resolve = async (requested?: unknown, needs: SttNeeds = {}, language: string | null = null): Promise<SttResolution> => {
    const order: SttProviderId[] = [];
    const push = (id: SttProviderId | null | undefined) => id && allowed.includes(id) && !order.includes(id) && order.push(id);
    const requestedProvider = isSttProviderId(requested) ? requested : null;
    push(requestedProvider);
    push(preference.preferred);
    allowed.forEach(push);
    const asked = order[0] ?? null;
    // Two reasons, kept apart on purpose. A capable engine that is not INSTALLED
    // is the actionable fact ("download a model"); an engine skipped because it
    // could never do the job is background. Collapsing them into one variable
    // let the last loop iteration decide which the operator got told, which is
    // how "no model installed" turns into "would send the audio off this
    // machine" and sends them to fix the wrong thing.
    let lastGap: string | null = null;
    let lastNotReady: string | null = null;
    for (const id of order) {
      const provider = get(id);
      const gap = capabilityGap(provider, needs, language);
      if (gap) {
        lastGap ??= `${id}: ${gap}`;
        continue;
      }
      const probe = await provider.probe();
      if (probe.state === "ready") {
        const fallbackFrom = asked && asked !== id ? asked : null;
        const reason = lastNotReady ?? lastGap;
        if (fallbackFrom) opts.host.log?.({ type: "fallback", from: fallbackFrom, to: id, reason: reason ?? "" });
        // A request for a provider this deployment does not allow was dropped
        // from `order` before the loop, so `asked` is the preference and
        // `fallbackFrom` is null. The caller still had its pick overruled, and
        // `requestedProvider` is the only place that fact survives.
        return { provider, fallbackFrom, reason: fallbackFrom ? reason : null, requestedProvider };
      }
      lastNotReady = `${id}: ${probe.reason}`;
    }
    // "Nothing that could do this is installed" and "nothing allowed here can do
    // this at all" are different facts, and only the second one names a
    // capability the operator could go and enable.
    if (lastNotReady) throw new SttError("unavailable", lastNotReady);
    throw new SttError(lastGap ? "unsupported" : "unavailable", lastGap ?? "no provider is allowed");
  };

  return {
    ids: providers.map((p) => p.id),
    preference: { preferred: preference.preferred, allowed },
    get,
    async status() {
      return Promise.all(
        providers.map(async (p) => {
          const probe = await p.probe();
          // A catalog is only meaningful for an engine that can serve: see
          // SttStatus.models. `models()` is allowed to fail (a readdir on a
          // vanished directory, a vendor 500) without taking the whole status
          // read down with it — a picker that lists no models is degraded, a
          // settings page that renders nothing is broken.
          let models: SttModel[] = [];
          if (probe.state === "ready") {
            try {
              models = await p.models();
            } catch (err) {
              opts.host.log?.({ type: "error", provider: p.id, message: err instanceof Error ? err.message : String(err) });
            }
          }
          return {
            id: p.id,
            label: p.label,
            kind: p.kind,
            capabilities: p.capabilities,
            probe,
            allowed: allowed.includes(p.id),
            preferred: preference.preferred === p.id,
            models,
          };
        }),
      );
    },
    resolve: (requested, needs, language) => resolve(requested, needs, language ?? null),
    async transcribe(raw, o) {
      const req = validateRequest(raw);
      const needs: SttNeeds = {
        ...o?.needs,
        diarization: o?.needs?.diarization || req.diarize === true,
        redaction: o?.needs?.redaction || req.redactPii === true,
      };
      const { provider, fallbackFrom, requestedProvider } = await resolve(o?.provider, needs, req.language);
      // The package-wide cap bounded the request before anything was resolved;
      // this is the SERVING engine's own ceiling, which may be lower.
      if (req.audio.byteLength > provider.capabilities.maxBytes) {
        throw new SttError("invalid_audio", `${provider.id} accepts at most ${provider.capabilities.maxBytes} bytes`, provider.id);
      }
      // The declared clip ceiling, enforced where the length is free to read: a
      // WAV header gives the real duration for the cost of a few arithmetic
      // ops, and every adapter declares a maxClipSeconds that nothing was
      // checking. A ceiling nobody enforces is a comment. Compressed containers
      // keep their length behind a decoder this package deliberately does not
      // carry (node/wav.ts), so for those the engine's own limit is still the
      // first thing that says no — an honest partial guard, not a silent one.
      const durationMs = req.mimeType === "audio/wav" || req.mimeType === "audio/x-wav" ? (wavInfo(req.audio)?.durationMs ?? null) : null;
      if (durationMs != null && durationMs > provider.capabilities.maxClipSeconds * 1000) {
        throw new SttError(
          "too_long",
          `${provider.id} accepts at most ${provider.capabilities.maxClipSeconds}s; this clip is ${Math.round(durationMs / 1000)}s`,
          provider.id,
        );
      }
      const run = () => provider.transcribe(req, o?.signal, o?.timeoutMs);
      const transcript =
        provider.kind === "local"
          ? await (() => {
              const turn = localQueue.then(run, run);
              localQueue = turn.catch(() => {});
              return turn;
            })()
          : await run();
      return { ...transcript, fallbackFrom, requestedProvider };
    },
  };
}
