// Fire-and-forget LightTrack emitter for the TS runtime — the counterpart to
// the Python monitor seam (pipeline/jobfit/llm/monitor.py). kp's Python pipeline
// already tracks every provider call to LightTrack through that seam; this module
// does the same for the handful of provider calls that originate directly in
// TypeScript and never reach Python's monitor (today: the github-analysis deep
// review, app/api/github-analysis/route.ts).
//
// LightTrack (sibling repo ../tracklight — the self-hosted LLM observability
// service this project standardizes on) prices each event server-side from its
// own price book; we attach our own cost_usd as metadata for cross-checking,
// exactly like monitor.py does. Activation is double-gated to match the Python
// side: it only emits when LIGHTTRACK_URL is set (the default deployment has it
// unset, so this is a no-op). Every emit is best-effort and fully
// exception-swallowed — a LightTrack outage can never break the host request.
//
// Server-only: reads process.env and posts over the network; never import from a
// client component. Dependency-free (global fetch) so it stays loadable in the
// same lean contexts as the rest of app/_lib.

// LightTrack normalizes provider aliases server-side too, but we fold the ones
// kp uses up front so TS-direct traffic groups with the Python adapters' events
// (gemini → google) instead of landing under a separate "gemini" bucket.
const PROVIDER_ALIASES: Record<string, string> = {
  gemini: "google",
  google: "google",
  vertex: "google",
  claude: "anthropic",
  anthropic: "anthropic",
  claude_cli: "anthropic",
  openai: "openai",
  azure_openai: "openai",
};

export type LightTrackInput = {
  provider: string;
  model?: string | null;
  /** The kp use-case id — becomes the LightTrack `operation` (per-tool attribution). */
  useCase?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedTokens?: number | null;
  /** Our locally computed cost — passed as metadata; LightTrack prices authoritatively. */
  costUsd?: number | null;
  latencyMs?: number | null;
  tags?: string[];
  /** When set, records a failed call (error event) instead of a success. */
  error?: string;
};

/** Timeout for the fire-and-forget POST — mirrors the SDK default (2s). */
const LIGHTTRACK_TIMEOUT_MS = 2000;

const intOrUndef = (v: number | null | undefined): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : undefined;

/**
 * Record one TS-originated LLM call to LightTrack. Returns immediately; the POST
 * is not awaited (telemetry stays off the request's critical path). A no-op when
 * LIGHTTRACK_URL is unset, and never throws — a malformed input or a down server
 * is swallowed, same contract as monitor.emit_result on the Python side.
 */
export function trackLlmToLightTrack(input: LightTrackInput): void {
  const base = process.env.LIGHTTRACK_URL;
  if (!base) return; // observability off (the default deployment) — nothing to do

  try {
    const usage: Record<string, number> = {
      input: intOrUndef(input.inputTokens) ?? 0,
      output: intOrUndef(input.outputTokens) ?? 0,
    };
    const cached = intOrUndef(input.cachedTokens);
    if (cached != null) usage.cached_input = cached;

    const provider = PROVIDER_ALIASES[input.provider] ?? input.provider;
    const event: Record<string, unknown> = { provider, model: input.model ?? "unknown", usage, source: "kp" };

    const project = process.env.LIGHTTRACK_PROJECT;
    if (project) event.project_id = project;
    if (input.useCase) event.operation = input.useCase;
    const latency = intOrUndef(input.latencyMs);
    if (latency != null) event.latency_ms = latency;
    if (input.error) {
      event.error = input.error.slice(0, 500);
      event.status = "error";
    }
    // Tag TS-direct traffic so it's distinguishable from the Python-metered
    // adapters that dominate the ledger (matching monitor.py's "llm-layer" tag),
    // plus a `tool:<use_case>` tag for per-tool attribution — the server stores
    // `operation` as a small enum, so the tag is what LightTrack groups spend by.
    event.tags = ["llm-layer", "runtime:ts", ...(input.useCase ? [`tool:${input.useCase}`] : []), ...(input.tags ?? [])];
    if (input.costUsd != null) event.metadata = { cost_usd: input.costUsd };

    const url = base.replace(/\/+$/, "") + "/v1/events";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const key = process.env.LIGHTTRACK_KEY;
    if (key) headers.Authorization = `Bearer ${key}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIGHTTRACK_TIMEOUT_MS);
    void fetch(url, { method: "POST", headers, body: JSON.stringify(event), signal: controller.signal })
      .catch(() => undefined) // best-effort: telemetry must never break the host app
      .finally(() => clearTimeout(timer));
  } catch {
    // building the event failed (unexpected input shape) — telemetry is optional
  }
}
