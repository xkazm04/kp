import { parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
// Import the SLICES, not the `./db` barrel — the barrel `export *`s 17 store
// modules and `next dev` compiles a route's whole module graph with no
// tree-shaking (the same note sits at the top of companion-run.ts).
import { countBrainEntries } from "./db/companion";
import { getCompanionBrainConsent, setCompanionBrainConsent } from "./db/workspaces";
import { coerceBrainProbe, type CompanionBrainProbe, type CompanionBrainStatus } from "./companion-brain-probe";

// The consent half of the operator companion (docs/features/companion/README.md,
// WP4). Candi's memory is a tree of markdown files on the OPERATOR'S OWN MACHINE,
// shared with Personas' Athena — so kp is not entitled to create it, adopt it, or
// write into it until the operator has said yes. This module owns that decision;
// `companion_cli.py` owns the tree.
//
// Three doors and one rule:
//   probeCompanionBrain   what is on disk, creating NOTHING
//   birthCompanionBrain   ensure_brain behind a flag — idempotent, never overwrites
//   companionMemoryEnabled  may a turn touch the brain at all
//
// The probe is deliberately its own spawn rather than a field on the turn: the
// wizard asks it BEFORE any conversation exists, and folding it into a turn would
// mean the only way to find out whether a brain exists is to have already used it.

/** Wall-clock backstop for the two brain doors. Both are filesystem-only — no
 *  model call, no index open — so the generous 10-minute default the LLM CLIs
 *  need would only mean a wedged wizard step waiting ten minutes to say so. */
const BRAIN_SPAWN_TIMEOUT_MS = 20_000;

async function runBrainDoor(flag: "--probe" | "--birth", signal?: AbortSignal): Promise<CompanionBrainProbe> {
  const { result } = spawnPython(["-m", "pipeline.jobfit.companion_cli", flag], {
    signal,
    timeoutMs: BRAIN_SPAWN_TIMEOUT_MS,
  });
  const { stdout, stderr, exitCode } = await result;
  if (exitCode !== 0) throw new Error(parseStderrError(stderr, exitCode).message);
  return coerceBrainProbe(parsePythonJson<unknown>(stdout, stderr));
}

/** What the brain holds, without creating any of it. */
export function probeCompanionBrain(signal?: AbortSignal): Promise<CompanionBrainProbe> {
  return runBrainDoor("--probe", signal);
}

/** Create the tree if it is missing, and answer with the brain that now stands.
 *  `ensure_brain` never overwrites a constitution or an identity that already
 *  exists — birthing over an edited self would silently discard it — so calling
 *  this against a populated brain is a no-op that returns the truth about it. */
export function birthCompanionBrain(signal?: AbortSignal): Promise<CompanionBrainProbe> {
  return runBrainDoor("--birth", signal);
}

/**
 * May a companion turn read or write the brain?
 *
 * TWO arms, and the second one is the whole reason this is a function rather
 * than a column read:
 *
 *   1. EXPLICIT — the workspace recorded 'connected' or 'birthed' at first run.
 *   2. IMPLICIT — `companion_brain_index` already holds at least one episode for
 *      this workspace. A row lands there only because `append_episode` put it
 *      there, so it is proof that kp has ALREADY written to this brain on this
 *      machine, with this workspace's session tag.
 *
 * The implicit arm exists for the installs that predate the consent gate: an
 * operator who has been talking to Candi for weeks must not have their memory
 * switched off by a feature that arrived after it. It is deliberately keyed on
 * kp's OWN writes and not on the probe's `present`: a brain that exists because
 * Personas' Athena made it is somebody else's mind, and adopting it silently is
 * exactly the thing the consent gate is for. Skipping the step therefore leaves
 * a fresh workspace memoryless, and that state is stable — with memory off no
 * episode is written, so the implicit arm can never bootstrap itself into a yes.
 *
 * Cheap by construction (one indexed COUNT), because every message turn asks.
 */
export function companionMemoryEnabled(workspaceId: string): boolean {
  if (getCompanionBrainConsent(workspaceId) !== null) return true;
  return countBrainEntries(workspaceId) > 0;
}

/** Record what the operator chose. `connect` adopts the brain already on disk
 *  and MODIFIES NOTHING about it; `birth` is stamped by the route after the tree
 *  actually exists, so consent never claims a brain that was not created. */
export function recordCompanionBrainConsent(choice: "connect" | "birth", workspaceId: string): void {
  setCompanionBrainConsent(choice === "connect" ? "connected" : "birthed", workspaceId);
}

/** The probe plus the two workspace facts the wizard branches on. Assembled in
 *  one place so the GET and the POST cannot disagree about what "settled" means. */
export function companionBrainStatus(probe: CompanionBrainProbe, workspaceId: string): CompanionBrainStatus {
  return {
    ...probe,
    consent: getCompanionBrainConsent(workspaceId),
    memoryEnabled: companionMemoryEnabled(workspaceId),
  };
}
