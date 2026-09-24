// The late-bound interview-invite door the stage hook mints through — the seam that
// keeps the mint's implementation OFF the import graph of every route that touches
// app/_lib/db/pipeline.ts.
//
// db/pipeline.ts reaches stage-hooks.ts (lazily, but the perf budget counts dynamic
// imports too), and db/pipeline.ts is on nearly every route. A static edge from
// stage-hooks.ts to interview-invite.ts therefore put the whole mint — interview-run's
// grounding build, the job-kit pin and booking, the connect-time agenda and director
// brief, the voice providers — on every one of those routes' first-hit compile: 21
// modules on /api/tasks alone (measured 2026-09-18, scripts/perf/check-budget.mjs),
// six of them added that day by the kit pin and the directed agenda.
//
// So the door is registered at BOOT (late-bound-boot.ts, called from
// instrumentation-node.ts, which is not on any route's path), and stage-hooks.ts only
// holds this registry. The module imports nothing at runtime — the two types below are
// erased — so it is a leaf.
//
// Contract: the registered function IS `mintAndInviteVoiceScreen`, the same door
// POST /api/interview/create calls statically; nothing is re-implemented behind the
// seam. An unregistered door is a boot-order bug, answered with a thrown error that
// names the registration. stage-hooks.ts meets it inside its own try, so the move that
// already committed still stands, the candidate is parked for a human on the calendar
// gate, and the server log carries this message — never a silent skip.

import type { VoiceScreenMintInput, VoiceScreenMintResult } from "./interview-invite";

export type StageHookInvite = (input: VoiceScreenMintInput) => Promise<VoiceScreenMintResult>;

// On globalThis, not in module scope, for the reason task-external-runners.ts states:
// Next evaluates the instrumentation chunk (which registers) and the route chunk (which
// reads) separately, so a module-level slot would be two slots.
const REGISTRY_KEY = "__kpStageHookInvite";
const holder = globalThis as typeof globalThis & { [REGISTRY_KEY]?: { invite: StageHookInvite | null } };
const slot: { invite: StageHookInvite | null } = holder[REGISTRY_KEY] ?? (holder[REGISTRY_KEY] = { invite: null });

/** Boot-time registration (late-bound-boot.ts). Re-registering replaces — the dev
 *  server re-runs instrumentation on reload and must not throw on the second pass. */
export function registerStageHookInvite(invite: StageHookInvite): void {
  slot.invite = invite;
}

/** The registered mint door, or a thrown error naming the missing registration. */
export function stageHookInvite(): StageHookInvite {
  if (!slot.invite) {
    throw new Error(
      "the stage hook's interview-invite door is not registered — instrumentation-node.ts registers it at boot (late-bound-boot.ts)"
    );
  }
  return slot.invite;
}

/** For tests: forget the registration. */
export function _resetStageHookInviteForTests(): void {
  slot.invite = null;
}
