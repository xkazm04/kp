import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getCampaignPack, getJob, saveCampaignPack } from "@/app/_lib/db";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "@/app/_lib/python-runner";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// E1 (Erika gap) — the sourcing campaign pack for one job: feed-ready ad-copy
// variants + 15s video scripts, generated per candidate language. GET returns
// the stored pack; POST spends a generation (Claude CLI when available, the
// deterministic builder otherwise) and upserts it. No prompt cache on purpose:
// the pack is a durable recruiter artifact (campaign_packs table) and
// "Regenerate" must mean a fresh creative pass, not a cached replay.

function resolveLang(value: unknown): Locale {
  const v = String(value ?? "");
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  const lang = resolveLang(new URL(request.url).searchParams.get("lang"));
  return NextResponse.json({ pack: getCampaignPack(job.id, lang) });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  let workdir: string | null = null;
  try {
    const { id } = await context.params;
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as { lang?: unknown };
    const lang = resolveLang(body.lang);

    // The CTA every variant closes with: the ≤30s quick-apply lead form (E2),
    // absolute (the ad runs off-app) and pinned to the pack's language.
    const applyUrl = `${publicBaseUrl(new URL(request.url).origin)}/apply/${job.id}/quick?lang=${lang}`;

    workdir = await createWorkdir();
    const jobPath = path.join(workdir, "job.json");
    await writeFile(jobPath, JSON.stringify(job), "utf-8");

    // Thread the request's AbortSignal so closing the modal mid-generation
    // kills the CLI child instead of leaking it to the timeout backstop.
    const { result } = spawnPython(
      ["-m", "pipeline.jobfit.campaign_cli", "--job-json", jobPath, "--lang", lang, "--apply-url", applyUrl],
      { signal: request.signal }
    );
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const payload = parsePythonJson<{ result: unknown; source?: string }>(stdout, stderr);
    const pack = saveCampaignPack(job.id, lang, payload.result, String(payload.source ?? "deterministic"));
    return NextResponse.json({ pack });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Campaign generation failed." },
      { status: 500 }
    );
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
