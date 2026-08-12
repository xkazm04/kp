import { NextRequest, NextResponse } from "next/server";
import { getCampaignPack } from "@/app/_lib/db/campaign";
import { getJob } from "@/app/_lib/db/jobs";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { CampaignError, runCampaign } from "@/app/_lib/campaign-run";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";


// E1 (Erika gap) — the sourcing campaign pack for one job: feed-ready ad-copy
// variants + 15s video scripts, generated per candidate language. GET returns
// the stored pack. POST is the synchronous convenience wrapper over
// app/_lib/campaign-run.ts — the UI runs generation through the background task
// kind "campaign" (tracked, dedup'd, refresh-safe); both share runCampaign.
// No prompt cache on purpose: the pack is a durable recruiter artifact
// (campaign_packs table) and "Regenerate" must mean a fresh creative pass.

function resolveLang(value: unknown): Locale {
  const v = String(value ?? "");
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  const lang = resolveLang(new URL(request.url).searchParams.get("lang"));
  // Scope the pack read to the session team: campaign_packs is workspace-stamped, so
  // an unscoped read (defaulting to the single tenant) would serve/overwrite the
  // wrong team's pack for a job in any other workspace.
  return NextResponse.json({ pack: getCampaignPack(job.id, lang, await currentWorkspace()) });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { lang?: unknown };
    // Thread the request's AbortSignal so closing the modal mid-generation
    // kills the CLI child instead of leaking it to the timeout backstop.
    const { pack } = await runCampaign(
      { jobId: id, lang: resolveLang(body.lang), origin: new URL(request.url).origin },
      request.signal,
      await currentWorkspace()
    );
    return NextResponse.json({ pack });
  } catch (error) {
    if (error instanceof CampaignError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Campaign generation failed." },
      { status: 500 }
    );
  }
}
