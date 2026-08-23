// Multi-provider LLM layer — TS half (docs/architecture/llm-provider-layer.md).
//
// This module owns: the provider/use-case catalogs (kept in sync with
// pipeline/jobfit/llm/capabilities.py) and assembly of the KP_LLM_CONFIG env
// var that spawnPython hands to the Python registry. Key encryption lives in
// llm-secret.ts; the DB rows live behind plain accessors in db.ts.
//
// Resolution layering (Python side mirrors this):
//   llm_config row → adapter; no row → Claude CLI (local default, unchanged).
//   key: UI-entered 'byom' row → 'platform' row → provider env var.

// The SLICE, not the `./db` barrel — this module is the single biggest compile hub
// in the app. It is pulled in by job-ingest, the analyze/jd/interview paths and the
// Python bridge, so through the barrel it dragged all 17 store modules into routes
// that touch neither LLM config nor most of the DB (e.g. /api/attention, which only
// counts badges). Cutting it here took /api/attention's graph from 68 modules /
// 863 KB to 43 / 560 KB. See "Dev compile cost" in docs/architecture/app-structure.md.
import { listLlmConfig, listProviderKeys, upsertProviderKey, type LlmConfigRow } from "./db/llm";
import { decryptProviderSecret, encryptProviderSecret } from "./llm-secret";
import { resolveProviderApiKey } from "./provider-key-precedence";
import { assertPublicHttpsEndpointResolved } from "./ats-egress-guard.ts";

// Keep in sync with PROVIDER_CAPABILITIES / USE_CASE_REQUIREMENTS in
// pipeline/jobfit/llm/capabilities.py — Python is authoritative; these lists
// only gate what the admin API will accept.
export const LLM_PROVIDERS = ["anthropic", "openai", "azure_openai", "gemini", "openrouter", "qwen", "ollama", "claude_cli"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const LLM_USE_CASES = [
  "*",
  "match_reasoning",
  "automation",
  "campaign_pack",
  "jd_ingest",
  "profile_draft",
  "group_compare",
  "devcase_analyze",
  "devcase_role_design",
  "devcase_case_design",
  "devcase_reflect",
  "devcase_tooling",
  "devcase_evaluate",
  "devcase_transfer",
  "devcase_judge",
  "devcase_interview_scenario",
  "devcase_seed",
  "weight_proposal",
  "interview_scorecard",
  "agent_fit",
  "repo_scan",
  "role_intake",
  "role_intake_voice",
  "github_analysis",
  "cv_analysis",
  "profile_extract",
] as const;
export type LlmUseCase = (typeof LLM_USE_CASES)[number];

export function isLlmProvider(value: unknown): value is LlmProvider {
  return typeof value === "string" && (LLM_PROVIDERS as readonly string[]).includes(value);
}

/** True when this provider CAN be called without an API key (KEYLESS_PROVIDERS) —
 *  the route then accepts a row carrying only a base URL. */
export function isKeylessProvider(value: unknown): value is LlmProvider {
  return isLlmProvider(value) && providerIsKeyless(value);
}

// What the keys form offers and the PUT accepts. Everything except `claude_cli`,
// which has nothing to configure — no key, no endpoint, it just runs the local CLI.
// Ollama IS offered (it was not before) precisely so its base URL can be set from
// Settings rather than only from the process environment: pointing the app at a
// model server on your own machine is the first thing a self-hoster does.
export const KEYABLE_PROVIDERS = LLM_PROVIDERS.filter((p) => p !== "claude_cli");

export function isKeyableProvider(value: unknown): value is LlmProvider {
  return isLlmProvider(value) && value !== "claude_cli";
}

// Which providers must be told a model (Azure deployments, OpenRouter/Qwen/Ollama
// slugs) lives in its own store-free module so the browser and `node --test` can
// both load it; re-exported here so llm-config stays the one import for the
// provider catalogs.
export {
  BASE_URL_PROVIDERS,
  KEYLESS_PROVIDERS,
  MODEL_REQUIRED_PROVIDERS,
  providerAcceptsBaseUrl,
  providerIsKeyless,
  providerNeedsExplicitModel,
} from "./llm-model-defaults";

// The base-URL rule is used as a TYPE GUARD in this module (saveProviderKey narrows
// on it), which the structural re-export above cannot express — it takes a string,
// not an LlmProvider. Local narrowing wrapper over the same single source.
import { providerAcceptsBaseUrl as acceptsBaseUrl, providerIsKeyless } from "./llm-model-defaults";
function isBaseUrlProvider(value: LlmProvider): boolean {
  return acceptsBaseUrl(value);
}

export function isLlmUseCase(value: unknown): value is LlmUseCase {
  return typeof value === "string" && (LLM_USE_CASES as readonly string[]).includes(value);
}

const KP_LLM_CONFIG_ENV = "KP_LLM_CONFIG";

export type ProviderKeyInput = {
  provider: LlmProvider;
  scope?: "byom" | "platform";
  /** May be empty for a keyless provider (see KEYLESS_PROVIDERS) — a stock Ollama
   *  or llama.cpp server checks no credential. Stored encrypted either way; an
   *  empty value is simply not emitted into KP_LLM_CONFIG. */
  apiKey: string;
  /** Azure: resource endpoint + api version travel with the key. */
  endpoint?: string;
  apiVersion?: string;
  /** OpenAI-compatible server to talk to instead of the vendor's own cloud
   *  (Ollama, LM Studio, llama.cpp, vLLM, LiteLLM, an in-VPC gateway). Only
   *  persisted for BASE_URL_PROVIDERS. */
  baseUrl?: string;
};

/** Validate an OpenAI-compatible base URL.
 *
 *  Deliberately NOT `assertPublicHttpsEndpointResolved` — that guard exists to
 *  stop a bearer key being exfiltrated to a private address, and it rejects
 *  loopback, LAN and non-https on purpose. Here the opposite is the whole point:
 *  `http://localhost:11434/v1` and `http://vllm.internal:8000/v1` are the normal,
 *  intended values. The threat models genuinely differ:
 *
 *    Azure endpoint — a cloud credential is forwarded to a host the user named,
 *                     so a private-resolving host is an SSRF/exfiltration pivot.
 *    base URL       — an operator points the app at their own inference server,
 *                     usually with no credential at all, on the same trust level
 *                     as the OPENAI_BASE_URL / OLLAMA_BASE_URL env vars this
 *                     replaces. Writing it requires `requireOperator`.
 *
 *  So the check is a shape check: parseable, http/https, and no embedded
 *  credentials (which would land in the DB and in log lines). */
function assertValidBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Base URL must be an absolute URL (got ${raw}).`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Base URL must be http or https (got ${url.protocol.replace(":", "")}).`);
  }
  if (url.username || url.password) {
    throw new Error("Base URL must not embed credentials — put the key in the API key field.");
  }
  return url.toString().replace(/\/$/, "");
}

// Azure resource endpoints live under this suffix; an operator can extend the
// allowlist with exact hosts via KP_LLM_ENDPOINT_ALLOWLIST (comma-separated) for
// sovereign/gov clouds or a gateway. Empty by default — no escape hatch needed
// for the common case.
const AZURE_ENDPOINT_SUFFIX = ".openai.azure.com";

function endpointHostAllowlist(): string[] {
  return (process.env.KP_LLM_ENDPOINT_ALLOWLIST ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export async function saveProviderKey(input: ProviderKeyInput): Promise<void> {
  const meta: Record<string, unknown> = {};
  // bug-ui-scan-2026-07-09 (model-api-key-management #2): endpoint/apiVersion are
  // Azure-only metadata (only the azure_openai adapter consumes them). DROP them
  // for any other provider so a stale client-side Azure endpoint — the field keeps
  // its state when the provider Select flips away from azure_openai — can never be
  // persisted onto, or later forwarded with, a non-Azure key. The client also omits
  // them from the request body; this is the server-side backstop.
  const endpoint = input.provider === "azure_openai" ? input.endpoint : undefined;
  const apiVersion = input.provider === "azure_openai" ? input.apiVersion : undefined;
  if (endpoint) {
    // SSRF guard: this endpoint is later handed to the provider SDK *with the
    // decrypted key*, so validate the host before it ever reaches the DB — reject
    // non-https, bare IPs (169.254.169.254 metadata, loopback, LAN) and internal
    // hosts. The string-level `assertPublicHttpsEndpoint` (in safe-url.ts) is the
    // FIRST gate here; `assertPublicHttpsEndpointResolved` runs it and then RESOLVES
    // the host, rejecting if any A/AAAA record is private/loopback/link-local/
    // metadata — closing the DNS-rebinding pivot where a public-looking name
    // (`https://rebind.attacker.com`) answers 169.254.169.254 at fetch time and the
    // bearer key is exfiltrated. Same server-only guard the ATS webhook boundary uses.
    await assertPublicHttpsEndpointResolved(endpoint, `${input.provider} endpoint`);
    const host = new URL(endpoint).hostname.toLowerCase();
    const allowed = host.endsWith(AZURE_ENDPOINT_SUFFIX) || endpointHostAllowlist().includes(host);
    if (!allowed) {
      throw new Error(`Azure endpoint must be a *.openai.azure.com resource (got ${host}).`);
    }
    meta.endpoint = endpoint;
  }
  if (apiVersion) meta.apiVersion = apiVersion;
  // Same DROP-for-the-wrong-provider discipline as endpoint/apiVersion above: a
  // baseUrl left standing in the form after the provider Select flips must never
  // be persisted onto a provider whose adapter would ignore it (or, worse, one
  // whose adapter would honour it and send the key somewhere unintended).
  if (isBaseUrlProvider(input.provider) && input.baseUrl) {
    meta.baseUrl = assertValidBaseUrl(input.baseUrl);
  }
  upsertProviderKey({
    provider: input.provider,
    scope: input.scope ?? "byom",
    keyCiphertext: encryptProviderSecret(input.apiKey),
    meta,
  });
}

// Masked provider-key metadata returned to the admin UI — the secret never leaves
// the server. Named + exported so KeysPanel imports this ONE shape instead of
// hand-copying it (the producer/consumer pair would otherwise silently drift when
// a field like a future Azure `region` is added).
export type ProviderKeyMeta = {
  provider: string;
  scope: string;
  endpoint?: string;
  apiVersion?: string;
  /** The configured OpenAI-compatible server, if any. Not a secret (it is a host
   *  the operator typed and needs to see to confirm), unlike the key beside it. */
  baseUrl?: string;
  updatedAt: string;
};

/** Masked listing for the admin surface — the secret never leaves the server. */
export function listProviderKeyMeta(): ProviderKeyMeta[] {
  return listProviderKeys().map((row) => ({
    provider: row.provider,
    scope: row.scope,
    ...(typeof row.meta.endpoint === "string" ? { endpoint: row.meta.endpoint } : {}),
    ...(typeof row.meta.apiVersion === "string" ? { apiVersion: row.meta.apiVersion } : {}),
    ...(typeof row.meta.baseUrl === "string" ? { baseUrl: row.meta.baseUrl } : {}),
    updatedAt: row.updatedAt,
  }));
}

/**
 * Decrypted API key for one provider, for the few TS-side call sites that hit a
 * provider SDK directly instead of spawning Python (github-analysis). Uses the
 * documented layering — UI-entered 'byom' row → 'platform' row → provider env
 * var(s), first-set-wins — so a customer's BYOM key serves their traffic exactly
 * like it does through KP_LLM_CONFIG. Returns undefined when nothing is
 * configured; a configured-but-undecryptable stored key throws (see
 * buildLlmConfigEnv — silently billing the wrong key is worse than failing).
 */
export function resolveProviderKey(provider: LlmProvider, envVars: readonly string[]): string | undefined {
  return resolveProviderApiKey({
    provider,
    rows: listProviderKeys(),
    decrypt: decryptProviderSecret,
    env: process.env,
    envVars,
  });
}

/**
 * Configured model for a use case, honored only when its row (specific, then the
 * "*" wildcard) routes to `provider`. For the TS-direct call sites that speak ONE
 * vendor SDK (github-analysis → Gemini): they cannot honor a provider swap, but
 * they must honor a model re-pin on their own provider instead of hardcoding it
 * (tiger #7 — the last structural bypass). Returns undefined when nothing matches.
 */
export function configuredModelFor(useCase: LlmUseCase, provider: LlmProvider): string | undefined {
  const rows = listLlmConfig();
  const row = rows.find((r) => r.useCase === useCase) ?? rows.find((r) => r.useCase === "*");
  if (!row || row.provider !== provider || !row.model) return undefined;
  return row.model;
}

// ---- KP_LLM_CONFIG assembly --------------------------------------------------

type UseCaseEntry = {
  provider: string;
  model?: string;
  params?: { maxTokens?: number; timeoutS?: number };
};

// `apiKey` is OPTIONAL: a keyless local server (Ollama, llama.cpp, LM Studio)
// stores a row with only a baseUrl, and the Python adapter supplies the
// placeholder the OpenAI SDK insists on (adapters/openai_api.py).
type KeysEntry = { apiKey?: string; endpoint?: string; apiVersion?: string; baseUrl?: string };

function toUseCaseEntry(row: LlmConfigRow): UseCaseEntry {
  const entry: UseCaseEntry = { provider: row.provider };
  if (row.model) entry.model = row.model;
  const maxTokens = Number(row.params.maxTokens);
  const timeoutS = Number(row.params.timeoutS);
  const params: UseCaseEntry["params"] = {};
  if (Number.isInteger(maxTokens) && maxTokens > 0) params.maxTokens = maxTokens;
  if (Number.isInteger(timeoutS) && timeoutS > 0) params.timeoutS = timeoutS;
  if (Object.keys(params).length > 0) entry.params = params;
  return entry;
}

/**
 * Env fragment for spawnPython: `{ KP_LLM_CONFIG: "<json>" }` when any LLM
 * routing/keys are configured, `{}` otherwise (Python then defaults to the
 * Claude CLI — byte-for-byte the pre-wrapper behavior).
 *
 * Decryption failures fail loud: a configured-but-undecryptable key means
 * KP_SECRET changed or is missing, and silently running on the platform/env
 * key instead of the customer's BYOM key would misattribute real spend.
 */
export function buildLlmConfigEnv(): Record<string, string> {
  const rows = listLlmConfig();
  const keyRows = listProviderKeys();
  if (rows.length === 0 && keyRows.length === 0) return {};

  const useCases: Record<string, UseCaseEntry> = {};
  for (const row of rows) useCases[row.useCase] = toUseCaseEntry(row);

  // 'byom' beats 'platform' for the same provider — the whole point of the
  // BYOM tier is that the customer's key serves their traffic.
  const keys: Record<string, KeysEntry> = {};
  const byPrecedence = [...keyRows].sort((a, b) => (a.scope === b.scope ? 0 : a.scope === "platform" ? -1 : 1));
  for (const row of byPrecedence) {
    const entry: KeysEntry = {};
    // Omit an empty key rather than emitting "": the Python side treats a present
    // apiKey as "use this credential", and a blank one would defeat the keyless
    // local-server path instead of falling through to the adapter's placeholder.
    const apiKey = decryptProviderSecret(row.keyCiphertext);
    if (apiKey) entry.apiKey = apiKey;
    if (typeof row.meta.endpoint === "string") entry.endpoint = row.meta.endpoint;
    if (typeof row.meta.apiVersion === "string") entry.apiVersion = row.meta.apiVersion;
    if (typeof row.meta.baseUrl === "string") entry.baseUrl = row.meta.baseUrl;
    keys[row.provider] = entry;
  }

  return { [KP_LLM_CONFIG_ENV]: JSON.stringify({ useCases, keys }) };
}

/**
 * Env fragment for a canary against ONE stored key — the keys panel's Test
 * button. Deliberately NOT `buildLlmConfigEnv()`: that builder applies the
 * byom-over-platform precedence, so a "Test" on a platform row would silently
 * prove the BYOM key sitting above it and report success for a credential that
 * was never called. This carries exactly the (provider, scope) row asked about
 * and no routing at all, so the verdict is about that key and nothing else.
 *
 * Returns null when the row does not exist. Decryption failures throw, same
 * contract as buildLlmConfigEnv.
 */
export function buildProviderKeyProbeEnv(provider: string, scope: string): Record<string, string> | null {
  const row = listProviderKeys().find((candidate) => candidate.provider === provider && candidate.scope === scope);
  if (!row) return null;
  const entry: KeysEntry = {};
  const apiKey = decryptProviderSecret(row.keyCiphertext);
  if (apiKey) entry.apiKey = apiKey;
  if (typeof row.meta.endpoint === "string") entry.endpoint = row.meta.endpoint;
  if (typeof row.meta.apiVersion === "string") entry.apiVersion = row.meta.apiVersion;
  // The probe must hit the SAME endpoint the real call would, or a green "Test"
  // proves nothing about the server the operator actually configured.
  if (typeof row.meta.baseUrl === "string") entry.baseUrl = row.meta.baseUrl;
  return { [KP_LLM_CONFIG_ENV]: JSON.stringify({ useCases: {}, keys: { [provider]: entry } }) };
}
