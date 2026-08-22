// Pure, DOM-free helpers for KeysPanel so the create-vs-replace guard and the
// Azure-only-endpoint body rule are unit-testable under `node --test` (a `.tsx`
// can't be loaded by the type-stripping runner). KeysPanel imports these.
import { providerAcceptsBaseUrl } from "@/app/_lib/llm-model-defaults";
import type { ProviderKeyMeta } from "@/app/_lib/llm-config";

/**
 * bug-ui-scan-2026-07-09 (model-api-key-management #4): the add form does an
 * upsert, so submitting onto an existing (provider, scope) pair silently REPLACES
 * a live, encrypted, unrecoverable key with no warning. Return the row a save
 * would overwrite so the UI can relabel the button + warn before the destructive
 * overwrite instead of treating create and replace identically.
 */
export function findExistingKey(
  keys: readonly ProviderKeyMeta[] | undefined,
  provider: string,
  scope: string
): ProviderKeyMeta | undefined {
  return keys?.find((k) => k.provider === provider && k.scope === scope);
}

/** The metadata boxes (endpoint / apiVersion / Server URL) the add-replace form
 *  must show for a (provider, scope) selection.
 *
 *  A save rewrites the row's metadata WHOLESALE — `upsertProviderKey`'s
 *  `ON CONFLICT … DO UPDATE SET meta_json = excluded.meta_json` — so a box left
 *  blank DELETES whatever was stored there; it does not mean "leave it alone".
 *  The form never seeded these boxes from the stored row, so rotating the key on
 *  an `openai` row pointed at an in-house gateway wiped its Server URL without a
 *  word, and the next call went to the vendor cloud carrying the gateway's key.
 *  Seeding from the row a save would REPLACE makes the boxes state what will be
 *  stored, and keeps clearing one a deliberate act.
 *
 *  Same drop-for-the-wrong-provider discipline as `buildKeyRequestBody`: only the
 *  fields the selected provider actually owns are offered back, so nothing can be
 *  re-seeded from a row whose provider has since been flipped away. */
export function keyFormMetaFor(
  keys: readonly ProviderKeyMeta[] | undefined,
  provider: string,
  scope: string
): { endpoint: string; apiVersion: string; baseUrl: string } {
  const existing = findExistingKey(keys, provider, scope);
  const isAzure = provider === "azure_openai";
  return {
    endpoint: isAzure ? (existing?.endpoint ?? "") : "",
    apiVersion: isAzure ? (existing?.apiVersion ?? "") : "",
    baseUrl: providerAcceptsBaseUrl(provider) ? (existing?.baseUrl ?? "") : "",
  };
}

export type KeyRequestBody = {
  provider: string;
  scope: "byom" | "platform";
  apiKey: string;
  endpoint?: string;
  apiVersion?: string;
  baseUrl?: string;
};

/**
 * bug-ui-scan-2026-07-09 (model-api-key-management #2): endpoint/apiVersion are
 * Azure-only fields. The endpoint input is hidden — but its React state RETAINED —
 * when the provider Select flips away from azure_openai, so include them in the PUT
 * body ONLY for azure_openai. A stale Azure resource URL can therefore never ride
 * along on an OpenAI (or any non-Azure) key. Server-side saveProviderKey drops them
 * too (defense in depth), but building the body correctly stops the leak at source.
 */
export function buildKeyRequestBody(input: {
  provider: string;
  scope: "byom" | "platform";
  apiKey: string;
  endpoint: string;
  apiVersion: string;
  baseUrl?: string;
}): KeyRequestBody {
  const isAzure = input.provider === "azure_openai";
  // Same retained-state hazard as the Azure endpoint above, one field over: the
  // base URL input is hidden but its React state survives a provider flip, so a
  // `http://localhost:11434/v1` typed for Ollama must not ride along on an
  // Anthropic key. Included only for the providers whose adapter reads it.
  const baseUrl = providerAcceptsBaseUrl(input.provider) ? (input.baseUrl ?? "").trim() : "";
  return {
    provider: input.provider,
    scope: input.scope,
    apiKey: input.apiKey.trim(),
    ...(isAzure && input.endpoint.trim() ? { endpoint: input.endpoint.trim() } : {}),
    ...(isAzure && input.apiVersion.trim() ? { apiVersion: input.apiVersion.trim() } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };
}

/** Whether the add form can be submitted. A keyless provider (Ollama and friends —
 *  a stock local model server authenticates nothing) is satisfied by a base URL
 *  alone; everything else still needs a key. Mirrors the PUT's own rule so the
 *  button and the route can't disagree about what a valid row is. */
export function canSubmitKeyForm(input: {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  keylessProviders: readonly string[];
}): boolean {
  if (!input.provider) return false;
  if (input.apiKey.trim()) return true;
  return input.keylessProviders.includes(input.provider) && Boolean((input.baseUrl ?? "").trim());
}
