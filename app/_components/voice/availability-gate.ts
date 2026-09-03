// The voice portal's start gate, as a pure function (wave 18b).
//
// The bug this exists to make impossible: the /api/interview/connect availability
// probe stored its result in ONE nullable slot, and the failure path reset that
// slot to `null` — the same value it holds before the probe has answered. The
// render then read `availability ? availability[provider] : true`, so "we could
// not find out" and "we have not asked yet" both resolved to AVAILABLE. On a
// keyless install, or when the server was down or the fetch was blocked, the
// candidate therefore got a normal, enabled Start button that failed at connect
// — while `unavailableCandidate`, the honest copy written for exactly this
// moment, was unreachable.
//
// A probe has THREE outcomes and they are not interchangeable, so the state is a
// discriminated union rather than a nullable map, and the gate names the fourth
// (still in flight) separately from the third (asked, and we do not know).
import type { VoiceAvailability, VoiceProviderId } from "@/app/_lib/voice/types";

export type AvailabilityProbe =
  /** The fetch has not answered yet. */
  | { status: "loading" }
  /** The server answered: this is what is configured. */
  | { status: "ok"; availability: VoiceAvailability }
  /** The fetch failed (offline, 5xx, blocked). We know nothing. */
  | { status: "failed" };

/** What the Start control may claim.
 *  - `checking`   — probe in flight; Start stays enabled (it always has; the
 *                   connect call itself refuses honestly and the probe is fast).
 *  - `available`  — the provider is configured.
 *  - `unavailable`— the provider is NOT configured: show the unavailable copy.
 *  - `unknown`    — the probe FAILED: never a plain Start. Say we could not
 *                   check and offer a retry. */
export type StartGate = "checking" | "available" | "unavailable" | "unknown";

export function voiceStartGate(probe: AvailabilityProbe, provider: VoiceProviderId): StartGate {
  if (probe.status === "loading") return "checking";
  if (probe.status === "failed") return "unknown";
  return probe.availability[provider] ? "available" : "unavailable";
}

/** May the candidate press Start? Only `unavailable` and `unknown` refuse — the
 *  second being the case that used to render an enabled button that could not work. */
export function canStart(gate: StartGate): boolean {
  return gate === "checking" || gate === "available";
}

/** The availability map when we actually have one — the provider picker needs the
 *  real answer and must not be handed a fabricated all-true map on a failed probe. */
export function probeAvailability(probe: AvailabilityProbe): VoiceAvailability | null {
  return probe.status === "ok" ? probe.availability : null;
}
