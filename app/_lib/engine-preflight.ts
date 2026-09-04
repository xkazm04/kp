import { existsSync } from "node:fs";
import path from "node:path";

// DATA4 — preflight for the two text-LLM engines, whose failure modes are
// opposite and equally invisible: no Gemini key → an analyze task queues,
// spawns Python, and fails minutes later with an engine error; no `claude` on
// PATH → automation/reasoning/group-eval/JD-build silently produce
// deterministic fallback drafts that LOOK like AI output. The voice providers
// got an availability map (voiceAvailability); these are the same idea for the
// engines that power the core product.
//
// Server-only (reads env + scans PATH). Reported informationally on
// /api/health and /api/ops — deliberately NOT a degradedReason: running
// without the Claude CLI is a designed fallback mode, and failing a readiness
// probe over it would block deploys that intend it.

export type EngineAvailability = {
  /** A Gemini API key is configured (GEMINI_API_KEY or GOOGLE_API_KEY). */
  gemini: boolean;
  /** The `claude` CLI resolves on PATH (PATHEXT-aware on Windows). */
  claudeCli: boolean;
};

/** How long a PATH probe result is trusted, in ms.
 *
 *  This cache used to be FOR THE PROCESS LIFETIME, on the reasoning that PATH does not
 *  change under a running server. It does — the operator installing the Claude CLI to
 *  fix exactly the "running on deterministic fallbacks" state this preflight reports
 *  is the single most likely thing to happen right after they read it, and until now
 *  /api/health and /api/ops kept saying "absent" until someone restarted the server.
 *  A minute is short enough that the fix is visible while they are still looking at
 *  the page, and long enough that a polling ops dashboard is not re-scanning every
 *  PATH entry on every request. */
export const ENGINE_PREFLIGHT_TTL_MS = 60_000;

let cachedClaudeCli: boolean | null = null;
let cachedAt = 0;

function probeClaudeCli(now: number): boolean {
  if (cachedClaudeCli != null && now - cachedAt < ENGINE_PREFLIGHT_TTL_MS) return cachedClaudeCli;
  // Mirror claude_cli.py's _executable note: on Windows the CLI is claude.CMD/
  // .EXE etc. — a bare extensionless name only resolves on POSIX.
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  cachedClaudeCli = dirs.some((dir) =>
    exts.some((ext) => {
      try {
        return existsSync(path.join(dir, `claude${ext}`));
      } catch {
        return false; // unreadable PATH entry — treat as absent, keep scanning
      }
    })
  );
  cachedAt = now;
  return cachedClaudeCli;
}

/** The clock is injectable so the TTL can be tested without waiting a minute. */
export function engineAvailability(now: number = Date.now()): EngineAvailability {
  return {
    gemini: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    claudeCli: probeClaudeCli(now),
  };
}
