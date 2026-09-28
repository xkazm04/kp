// Use cases whose engine is fixed at the CALL SITE rather than by the routing table
// (docs/architecture/llm-provider-layer.md "Call-site pins"). The Python call site passes
// `pin=ProviderPin(provider, model)` to `resolve_provider` - a consumer override the
// operator's Models row cannot redirect; only policy outranks it (the CLI engine's
// KP_OFFLINE seal and production consumer-terms refusal, which degrade the call to its
// no-research answer).
//
// Import-free on purpose, so a client surface (the Models panel) can read it: llm-config.ts
// re-exports it for the server and for llm-capabilities-lockstep.test.ts, which holds it
// equal to the Python `PIN`.

/** One call-site pin: the engine a use case runs on whatever the routing table says. */
export type PinnedUseCase = { provider: string; model: string; reason: string };

export const PINNED_USE_CASES: Readonly<Record<string, PinnedUseCase>> = {
  role_research: {
    provider: "claude_cli",
    model: "claude-sonnet-5-5",
    reason:
      "Product-owner requirement: live web research (the Claude CLI's WebSearch + WebFetch) runs on Claude Sonnet 5.5; no other configured engine can research the web.",
  },
};
