import { createHash } from "node:crypto";
import { isOffline } from "../offline.ts";
import { classifyMintFailure, type VoiceMintCause } from "./mint-error.ts";
import { VOICE_MINUTE_PRICES } from "./minute-prices.ts";
import { isSelfHostedProvider } from "./self-hosted.ts";
import {
  coerceProviderId,
  DEFAULT_VOICE_PROVIDER,
  missingVoiceEnv,
  VOICE_PROVIDER_ORDER,
  type VoiceAdapter,
  type VoiceAvailability,
  type VoiceProviderId,
} from "./types.ts";

// Operator readiness for the realtime voice plane (challenge-r09 voice-provider-io/B).
//
// Before this, "available" meant "the env var NAMES are set" (missingVoiceEnv): a
// revoked OPENAI_API_KEY or a mistyped ELEVENLABS_AGENT_ID read as available until a
// candidate opened a link and met INTERVIEW_CONNECT_FAILED. The TTS and STT planes
// already speak three honest states (packages/voice-tts, packages/voice-stt); this is
// the realtime plane's version, with one more because "configured" is not evidence:
//
//   absent     a required env var is unset (offer setup: `need` names them)
//   unchecked  configured, but no mint has been tried inside VOICE_PROBE_TTL_MS
//   ready      a credential mint succeeded (with its latency)
//   broken     a mint failed (with a typed cause and the fix that cause needs)
//
// A PROBE is a credential mint that opens no conversation: OpenAI's client secret
// (asked to expire in 120 s) is useless without the SDP exchange, and the ElevenLabs
// signed URL is never dialed. Whether a provider meters an unused mint cannot be
// verified from here, so a probe is operator-triggered only (POST /api/voice/readiness,
// never on page load, limited per IP) and a read (GET) never mints: it reports the
// remembered verdicts.
//
// Pure apart from process.env (read at call time, like the rest of the voice lib):
// adapters, the clock, the failover counts and the probe memory are all injected.

/** How long a probe verdict stands before the row reads "unchecked" again. */
export const VOICE_PROBE_TTL_MS = 10 * 60_000;

/** The instruction a probe mints with. Carries no candidate, job or session data. */
export const VOICE_PROBE_INSTRUCTIONS = "Readiness probe. This session is never connected.";

export type VoiceReadinessState = "absent" | "unchecked" | "ready" | "broken";

/** What fixes a broken provider: env vars to set or correct, a self-hosted service to
 *  start (its base URL named), or nothing but time. */
export type VoiceRemedy = { kind: "env"; vars: string[] } | { kind: "service"; vars: string[] } | { kind: "retry" };

/** The per-minute price the usage ledger stamps on this provider's sessions, and
 *  where that number came from (minute-prices.ts). */
export type VoiceBilling =
  | { kind: "self-hosted"; usdPerMin: 0 }
  | { kind: "per-minute"; usdPerMin: number; source: "override" | "estimate"; malformedOverride?: string };

export type VoiceFailoverCount = { from: VoiceProviderId; to: VoiceProviderId; count: number };

export type VoiceReadinessRow = {
  provider: VoiceProviderId;
  state: VoiceReadinessState;
  /** Unset required env vars; empty unless `absent`. */
  need: string[];
  latencyMs: number | null;
  cause: VoiceMintCause | null;
  remedy: VoiceRemedy | null;
  /** When the verdict shown was taken (ISO); null when there is none in force. */
  checkedAt: string | null;
  billing: VoiceBilling;
  /** Sessions that fell back FROM this provider inside the failover window. */
  failovers: { to: VoiceProviderId; count: number }[];
};

export type VoicePreference = { requested: VoiceProviderId; honored: boolean; defaultProvider: VoiceProviderId };

export type VoiceReadinessReport = {
  providers: VoiceReadinessRow[];
  /** KP_VOICE_PROVIDER and whether it is the provider new links actually use; null
   *  when no preference is set. */
  preference: VoicePreference | null;
  /** KP_OFFLINE is on: the probe is refused, so the strip does not offer it. */
  offline: boolean;
  probeTtlMs: number;
};

export type ReadinessAdapters = Record<VoiceProviderId, VoiceAdapter>;

// Which env var fixes which failure, per provider. A Record over the id union, so a
// new provider is a compile error here until someone says what fixes it.
const REMEDY_VARS: Record<VoiceProviderId, Partial<Record<VoiceMintCause, VoiceRemedy>>> = {
  openai: {
    auth: { kind: "env", vars: ["OPENAI_API_KEY"] },
    not_found: { kind: "env", vars: ["OPENAI_REALTIME_MODEL"] },
  },
  elevenlabs: {
    auth: { kind: "env", vars: ["ELEVENLABS_API_KEY"] },
    not_found: { kind: "env", vars: ["ELEVENLABS_AGENT_ID", "ELEVENLABS_BASE_URL"] },
    unreachable: { kind: "service", vars: ["ELEVENLABS_BASE_URL"] },
    malformed: { kind: "service", vars: ["ELEVENLABS_BASE_URL"] },
  },
};

/** The fix a failure cause needs on this provider; timeouts and upstream faults are
 *  the provider's side, so "retry later" is the honest answer. */
export function remedyFor(provider: VoiceProviderId, cause: VoiceMintCause): VoiceRemedy {
  return REMEDY_VARS[provider][cause] ?? { kind: "retry" };
}

/** The operator override env var for a provider's per-minute price. The SAME name
 *  minute-prices.ts reads; readiness.test.ts pins that the two always agree on the
 *  resulting number (the drift guard), because only the ledger's copy bills. */
function priceOverrideVar(provider: VoiceProviderId): string {
  return `KP_VOICE_MINUTE_USD_${provider.toUpperCase()}`;
}

/** The price in force for `provider` and its source. Mirrors voiceMinutePriceUsd's
 *  rule without its console warning (a read must not log per render): an override
 *  that parses as a finite non-negative number wins; a malformed one is refused, the
 *  estimate stands, and the row names the variable so the operator can fix it. */
export function voiceBilling(provider: VoiceProviderId): VoiceBilling {
  if (isSelfHostedProvider(provider)) return { kind: "self-hosted", usdPerMin: 0 };
  const name = priceOverrideVar(provider);
  const raw = process.env[name];
  const estimate = VOICE_MINUTE_PRICES[provider];
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed) && parsed >= 0) return { kind: "per-minute", usdPerMin: parsed, source: "override" };
    return { kind: "per-minute", usdPerMin: estimate, source: "estimate", malformedOverride: name };
  }
  return { kind: "per-minute", usdPerMin: estimate, source: "estimate" };
}

/** KP_VOICE_PROVIDER against what new links will actually use. pickDefaultProvider
 *  (index.ts) silently skips a preference whose provider is unconfigured; this makes
 *  that visible. Same policy, restated without importing the adapters (the test pins
 *  the two to the same answer). */
export function voicePreference(avail: VoiceAvailability): VoicePreference | null {
  const requested = coerceProviderId(process.env.KP_VOICE_PROVIDER?.trim().toLowerCase());
  if (!requested) return null;
  const honored = avail[requested] === true;
  const defaultProvider = honored ? requested : (VOICE_PROVIDER_ORDER.find((p) => avail[p]) ?? DEFAULT_VOICE_PROVIDER);
  return { requested, honored, defaultProvider };
}

type Verdict =
  | { state: "ready"; latencyMs: number; at: number; stamp: string }
  | { state: "broken"; cause: VoiceMintCause; at: number; stamp: string };

export type ProbeMemory = Map<VoiceProviderId, Verdict>;

export function createProbeMemory(): ProbeMemory {
  return new Map();
}

/** The process-wide memory the route uses. In-memory by design: a verdict is a
 *  10-minute observation, not a record, and last-writer-wins is harmless. */
const sharedMemory: ProbeMemory = createProbeMemory();
export function sharedProbeMemory(): ProbeMemory {
  return sharedMemory;
}

/** A fingerprint of the configuration a verdict was taken against: rotating a key,
 *  a base URL or an agent id invalidates the verdict at once instead of showing a
 *  stale green for up to the TTL. Hashed, so the memory holds no key material. */
function configStamp(adapter: VoiceAdapter): string {
  const vars = new Set<string>(adapter.requiredEnv);
  for (const remedy of Object.values(REMEDY_VARS[adapter.id])) {
    if (remedy && remedy.kind !== "retry") for (const v of remedy.vars) vars.add(v);
  }
  const material = [...vars].sort().map((n) => `${n}=${process.env[n] ?? ""}`).join("\n");
  return createHash("sha256").update(material).digest("hex");
}

type Deps = {
  adapters: ReadinessAdapters;
  memory: ProbeMemory;
  failovers: VoiceFailoverCount[];
  now?: () => number;
  order?: readonly VoiceProviderId[];
};

function availabilityOf(adapters: ReadinessAdapters, order: readonly VoiceProviderId[]): VoiceAvailability {
  return Object.fromEntries(order.map((id) => [id, missingVoiceEnv(adapters[id]).length === 0])) as VoiceAvailability;
}

/** The report a READ serves: env, prices, preference, failover history and any
 *  verdict still in force. Never calls adapter.connect. */
export function buildVoiceReadiness(deps: Deps): VoiceReadinessReport {
  const now = (deps.now ?? Date.now)();
  const order = deps.order ?? VOICE_PROVIDER_ORDER;
  const providers = order.map((id): VoiceReadinessRow => {
    const adapter = deps.adapters[id];
    const need = missingVoiceEnv(adapter);
    const base = {
      provider: id,
      need,
      billing: voiceBilling(id),
      failovers: deps.failovers.filter((f) => f.from === id).map(({ to, count }) => ({ to, count })),
    };
    const empty = { latencyMs: null, cause: null, remedy: null, checkedAt: null };
    if (need.length > 0) return { ...base, ...empty, state: "absent" };
    const verdict = deps.memory.get(id);
    if (!verdict || now - verdict.at >= VOICE_PROBE_TTL_MS || verdict.stamp !== configStamp(adapter)) {
      return { ...base, ...empty, state: "unchecked" };
    }
    const checkedAt = new Date(verdict.at).toISOString();
    return verdict.state === "ready"
      ? { ...base, ...empty, state: "ready", latencyMs: verdict.latencyMs, checkedAt }
      : { ...base, ...empty, state: "broken", cause: verdict.cause, remedy: remedyFor(id, verdict.cause), checkedAt };
  });
  return {
    providers,
    preference: voicePreference(availabilityOf(deps.adapters, order)),
    offline: isOffline(),
    probeTtlMs: VOICE_PROBE_TTL_MS,
  };
}

/** Mint once per CONFIGURED provider, concurrently under allSettled (one hung provider,
 *  bounded by its adapter's 15 s mint timeout, never hides another's verdict), record
 *  the verdicts, and return the report. The minted credentials are dropped here: they
 *  never leave this function. The caller refuses under KP_OFFLINE before calling. */
export async function probeVoiceProviders(deps: Deps): Promise<VoiceReadinessReport> {
  const clock = deps.now ?? Date.now;
  const order = deps.order ?? VOICE_PROVIDER_ORDER;
  const configured = order.filter((id) => missingVoiceEnv(deps.adapters[id]).length === 0);
  const settled = await Promise.allSettled(
    configured.map(async (id) => {
      const adapter = deps.adapters[id];
      const stamp = configStamp(adapter);
      const started = clock();
      try {
        await adapter.connect({ instructions: VOICE_PROBE_INSTRUCTIONS, sessionToken: null, tools: null });
        return { id, verdict: { state: "ready", latencyMs: Math.max(0, clock() - started), at: started, stamp } as Verdict };
      } catch (err) {
        return { id, verdict: { state: "broken", cause: classifyMintFailure(err), at: started, stamp } as Verdict };
      }
    })
  );
  for (const s of settled) {
    // Each task catches its own failure, so a rejection here is a programming error
    // in the bookkeeping above; it leaves that row unchecked rather than guessing.
    if (s.status === "fulfilled") deps.memory.set(s.value.id, s.value.verdict);
  }
  return buildVoiceReadiness(deps);
}
