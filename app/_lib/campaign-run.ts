import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getJob } from "./db/jobs";
import { saveCampaignPack } from "./db/campaign";
import { publicBaseUrl } from "./public-base-url";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
import { buildLlmConfigEnv } from "./llm-config";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";

// Campaign-pack generation, extracted from the POST /api/jobs/[id]/campaign route
// body so the SAME runner serves both the route (sync convenience wrapper) and
// the background task kind "campaign" (tasks.ts) — the wait-or-leave path: the
// pack persists in campaign_packs, so a recruiter who navigates away picks the
// finished pack up on their next visit to the Campaign tab (or from the task's
// unread flag). Mirrors the reasoning-run.ts split.

export class CampaignError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

export type CampaignParams = {
  jobId: string;
  lang?: string;
  /** The request origin at enqueue time — the quick-apply CTA must be absolute
   *  (the ad runs off-app), and a background handler has no request to read. */
  origin: string;
};

function resolveLang(value: unknown): Locale {
  const v = String(value ?? "");
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

export async function runCampaign(
  params: CampaignParams,
  signal?: AbortSignal,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<{ pack: unknown }> {
  const job = getJob(params.jobId);
  if (!job) throw new CampaignError("Job not found.", 404);
  const lang = resolveLang(params.lang);

  // The CTA every variant closes with: the ≤30s quick-apply lead form (E2),
  // absolute and pinned to the pack's language.
  const applyUrl = `${publicBaseUrl(params.origin)}/apply/${job.id}/quick?lang=${lang}`;

  let workdir: string | null = null;
  try {
    workdir = await createWorkdir();
    const jobPath = path.join(workdir, "job.json");
    await writeFile(jobPath, JSON.stringify(job), "utf-8");

    // buildLlmConfigEnv: the campaign_pack use case resolves the BYOM key + any
    // UI model re-route — without it the configured provider is silently dead.
    const { result } = spawnPython(
      ["-m", "pipeline.jobfit.campaign_cli", "--job-json", jobPath, "--lang", lang, "--apply-url", applyUrl],
      { signal, env: buildLlmConfigEnv() }
    );
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      throw new CampaignError(err.message, err.status);
    }
    const payload = parsePythonJson<{ result: unknown; source?: string }>(stdout, stderr);
    const pack = saveCampaignPack(job.id, lang, payload.result, String(payload.source ?? "deterministic"), workspaceId);
    return { pack };
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
