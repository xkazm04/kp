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
