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

// Once-per-process cache: PATH and the installed CLI don't change under a
// running server, and the probe scans every PATH entry.
let cachedClaudeCli: boolean | null = null;

function probeClaudeCli(): boolean {
  if (cachedClaudeCli != null) return cachedClaudeCli;
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
  return cachedClaudeCli;
}

export function engineAvailability(): EngineAvailability {
  return {
    gemini: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    claudeCli: probeClaudeCli(),
  };
}
