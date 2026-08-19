// Store-free provider RULES, shared by the server, the browser and `node --test`.
//
// Which providers cannot be called without being told a model.
//
// Its own module, not a constant inside llm-config.ts, for the same reason
// provider-key-precedence.ts is split out: llm-config.ts imports the SQLite
// store, so it is loadable neither by `node --test` nor by a client component.
// The keys panel needs this rule in the browser (to decide whether to ask for a
// model before probing a key) and the lockstep test needs it under the test
// runner, so it lives where both can reach it. llm-config.ts re-exports it.

/** The provider ids this rule can name. Kept structural (a plain string list) so
 *  this module stays free of the LlmProvider union's module graph. */
export const MODEL_REQUIRED_PROVIDERS: readonly string[] = ["azure_openai", "openrouter", "qwen", "ollama"];

/**
 * True when a provider's model is customer-named (an Azure deployment) or
 * addressed by slug/tag (OpenRouter, Qwen Cloud, a local Ollama tag) — i.e. its
 * DEFAULT_MODELS entry is None in pipeline/jobfit/llm/capabilities.py, which is
 * authoritative. `claude_cli` is the one None that is NOT listed: there, None
 * means "whatever the CLI itself is configured to run", a real default rather
 * than a missing one. llm-model-required.test.ts reads the Python source to keep
 * this list honest.
 */
export function providerNeedsExplicitModel(provider: string): boolean {
  return MODEL_REQUIRED_PROVIDERS.includes(provider);
}

/** Providers that speak the OpenAI Chat Completions wire format and therefore accept
 *  a `baseUrl` pointing at any other server that speaks it: Ollama, LM Studio,
 *  llama.cpp's server, vLLM, LiteLLM, an in-VPC gateway. This is the local-model
 *  path — running KP entirely on your own machine, which is the default posture of
 *  an open-source install.
 *
 *  Structural (a plain string list) for the same reason as MODEL_REQUIRED_PROVIDERS:
 *  the keys form needs the rule in the browser, and llm-config.ts drags the SQLite
 *  store in with it. llm-config.ts re-exports both. */
export const BASE_URL_PROVIDERS: readonly string[] = ["openai", "ollama", "qwen"];

export function providerAcceptsBaseUrl(provider: string): boolean {
  return BASE_URL_PROVIDERS.includes(provider);
}

/** Providers that authenticate nothing: `claude_cli` runs on the local CLI's own
 *  subscription login, and a stock Ollama / llama.cpp / LM Studio server checks no
 *  credential at all. A row for one of these is valid with a base URL and no key.
 *
 *  Store-free for the same reason as the rules above: the keys FORM has to decide
 *  whether its submit button is enabled, and it runs in the browser. */
export const KEYLESS_PROVIDERS: readonly string[] = ["claude_cli", "ollama"];

export function providerIsKeyless(provider: string): boolean {
  return KEYLESS_PROVIDERS.includes(provider);
}
