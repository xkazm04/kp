// Multi-provider LLM layer — TS half (docs/LLM_PROVIDER_LAYER.md).
//
// This module owns: the provider/use-case catalogs (kept in sync with
// pipeline/jobfit/llm/capabilities.py) and assembly of the KP_LLM_CONFIG env
// var that spawnPython hands to the Python registry. Key encryption lives in
// llm-secret.ts; the DB rows live behind plain accessors in db.ts.
//
// Resolution layering (Python side mirrors this):
//   llm_config row → adapter; no row → Claude CLI (local default, unchanged).
//   key: UI-entered 'byom' row → 'platform' row → provider env var.

import { listLlmConfig, listProviderKeys, upsertProviderKey, type LlmConfigRow } from "./db";
import { decryptProviderSecret, encryptProviderSecret } from "./llm-secret";
import { resolveProviderApiKey } from "./provider-key-precedence";
import { assertPublicHttpsEndpointResolved } from "./ats-egress-guard.ts";

// Keep in sync with PROVIDER_CAPABILITIES / USE_CASE_REQUIREMENTS in
// pipeline/jobfit/llm/capabilities.py — Python is authoritative; these lists
// only gate what the admin API will accept.
export const LLM_PROVIDERS = ["anthropic", "openai", "azure_openai", "gemini", "openrouter", "claude_cli"] as const;
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
  "github_analysis",
  "cv_analysis",
  "profile_extract",
] as const;
export type LlmUseCase = (typeof LLM_USE_CASES)[number];

export function isLlmProvider(value: unknown): value is LlmProvider {
  return typeof value === "string" && (LLM_PROVIDERS as readonly string[]).includes(value);
}

// Providers that take a stored key. claude_cli runs keyless (local default), so
// it is never offered in the keys form and the PUT rejects it. Single source for
// that "keyable provider" rule — the route and the admin UI both derive from here
// instead of hand-coding `!== "claude_cli"`.
export const KEYABLE_PROVIDERS = LLM_PROVIDERS.filter((p) => p !== "claude_cli");

export function isKeyableProvider(value: unknown): value is LlmProvider {
  return isLlmProvider(value) && value !== "claude_cli";
}

export function isLlmUseCase(value: unknown): value is LlmUseCase {
  return typeof value === "string" && (LLM_USE_CASES as readonly string[]).includes(value);
}

const KP_LLM_CONFIG_ENV = "KP_LLM_CONFIG";

export type ProviderKeyInput = {
  provider: LlmProvider;
  scope?: "byom" | "platform";
  apiKey: string;
  /** Azure: resource endpoint + api version travel with the key. */
  endpoint?: string;
  apiVersion?: string;
};

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
  updatedAt: string;
};

/** Masked listing for the admin surface — the secret never leaves the server. */
export function listProviderKeyMeta(): ProviderKeyMeta[] {
  return listProviderKeys().map((row) => ({
    provider: row.provider,
    scope: row.scope,
    ...(typeof row.meta.endpoint === "string" ? { endpoint: row.meta.endpoint } : {}),
    ...(typeof row.meta.apiVersion === "string" ? { apiVersion: row.meta.apiVersion } : {}),
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

// ---- KP_LLM_CONFIG assembly --------------------------------------------------

type UseCaseEntry = {
  provider: string;
  model?: string;
  params?: { maxTokens?: number; timeoutS?: number };
};

type KeysEntry = { apiKey?: string; endpoint?: string; apiVersion?: string };

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
    const entry: KeysEntry = { apiKey: decryptProviderSecret(row.keyCiphertext) };
    if (typeof row.meta.endpoint === "string") entry.endpoint = row.meta.endpoint;
    if (typeof row.meta.apiVersion === "string") entry.apiVersion = row.meta.apiVersion;
    keys[row.provider] = entry;
  }

  return { [KP_LLM_CONFIG_ENV]: JSON.stringify({ useCases, keys }) };
}
