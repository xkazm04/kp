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
  // gig_brief_cli.py `PIN`: the gig research brief follows the listing's references on the
  // web, the same engine and door as role_research.
  gig_brief: {
    provider: "claude_cli",
    model: "claude-sonnet-5-5",
    reason:
      "Product-owner requirement: a gig is researched once, on the web (the Claude CLI's WebSearch + WebFetch), by Claude Sonnet 5.5, following the references its listing names.",
  },
  // gig_plan_cli.py pins the SEAT's engine, model and effort (`PIN_PROVIDER` is the default
  // engine, `PIN_PROVIDERS` the two it accepts), so the model here names every seat's model -
  // the list app/_lib/gigs/plan-seats.ts holds (the lockstep test reads it). The GPT seat runs
  // on the pin-only Codex CLI, which no routing row can name, so `provider` stays the default.
  gig_plan: {
    provider: "claude_cli",
    model: "claude-sonnet-5-5, claude-opus-5-5, claude-fable-5, gpt-6-astra",
    reason:
      "Product-owner requirement: the plan seats follow the brief's difficulty (one Sonnet 5.5 high plan up to moderate, one Opus 5.5 high plan when hard, three side by side when very hard: Opus 5.5 xhigh, Fable 5 and GPT 6 Astra at max through the Codex CLI); the seats are fixed by kp, not by routing.",
  },
  // gig_report_cli.py `PIN`: the gig's HTML report is written by Sonnet 5.5 at high effort
  // from kp's facts (app/_lib/gigs/report/run.ts), whatever the routing table says.
  gig_report: {
    provider: "claude_cli",
    model: "claude-sonnet-5-5",
    reason:
      "Product-owner requirement: each gig's report file is written by Claude Sonnet 5.5 at high effort, from kp's facts and to the report bar kp's contest reports set; kp sanitises and assembles it, and writes it itself when no model can.",
  },
};
