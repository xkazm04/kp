import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  cleanupWorkdir,
  createWorkdir,
  parsePythonJson,
  parseStderrError,
  spawnPython as defaultSpawnPython,
} from "./python-runner";
import { buildLlmConfigEnv } from "./llm-config";
import { withLlmRequestIdIfUnset } from "./llm-request-context";

// AI profile-draft generation, extracted from the POST /api/profile/draft route
// body so the SAME runner serves the route (sync convenience wrapper) and the
// background task kind "profile_draft" (tasks.ts). The draft is NOT persisted —
// the recruiter reviews and saves via the Profile editor; when they leave
// mid-run, the finished draft stays readable on the task's result in the
// Background-tasks view.

export class ProfileDraftError extends Error {
  status: number;
  /**
   * The runner's stable machine code — "invalid_input" / "engine_error" /
   * "timeout", the same vocabulary `parseStderrError` already produces.
   * Dropping it here left /api/profile/draft unable to tell a missing-notes
   * refusal from an engine fault in the reader's locale.
   */
  code?: string;
  constructor(message: string, status = 500, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type ProfileDraftParams = {
  text: string;
  /** The requester's locale at enqueue time — a background handler has no request. */
  lang: string;
};

// Same child budget as the route's serverless contract (route maxDuration 60s − 5s
// cleanup margin) so the task path can't leak a longer-lived Gemini child.
export const PROFILE_DRAFT_TIMEOUT_MS = 55_000;

export async function runProfileDraft(
  params: ProfileDraftParams,
  signal?: AbortSignal,
  spawnPython: typeof defaultSpawnPython = defaultSpawnPython
): Promise<Record<string, unknown>> {
  const text = (params.text ?? "").trim();
  if (!text) throw new ProfileDraftError("Add some notes for the AI to draft from.", 400, "invalid_input");

  const requestId = `profile_draft:${createHash("sha256").update(text).digest("hex").slice(0, 12)}`;
  return withLlmRequestIdIfUnset(requestId, async () => {
    let workdir: string | null = null;
    try {
      workdir = await createWorkdir();
      const inputPath = path.join(workdir, "notes.json");
      await writeFile(inputPath, JSON.stringify({ text }), "utf-8");

      const { result } = spawnPython(
        ["-m", "pipeline.jobfit.profile_draft_cli", "--input-json", inputPath, "--lang", params.lang],
        { signal, timeoutMs: PROFILE_DRAFT_TIMEOUT_MS, env: buildLlmConfigEnv() }
      );
      const { stdout, stderr, exitCode } = await result;
      if (exitCode !== 0) {
        const err = parseStderrError(stderr, exitCode);
        throw new ProfileDraftError(err.message, err.status, err.code);
      }
      return parsePythonJson<Record<string, unknown>>(stdout, stderr);
    } finally {
      if (workdir) await cleanupWorkdir(workdir);
    }
  });
}
