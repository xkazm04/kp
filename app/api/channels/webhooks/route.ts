import { NextRequest, NextResponse } from "next/server";
import { createChannelWebhook, getJob, isWebhookChannel, listChannelWebhooks } from "@/app/_lib/db";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { isLocale } from "@/i18n/locales";


// E3 (Erika gap) — recruiter management of inbound channel webhooks. Each
// webhook binds one (channel, job, candidate-language) and yields the public
// receiver URL /api/channels/inbound/[token]. Listing/creating is a recruiter
// surface (trusted environment, like the rest of the workspace APIs); the
// RECEIVER is the public, token-gated boundary.

export async function GET() {
  return NextResponse.json({ webhooks: listChannelWebhooks(await currentWorkspace()) });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      channel?: unknown;
      jobId?: unknown;
      lang?: unknown;
    };
    const channel = String(body.channel ?? "");
    if (!isWebhookChannel(channel)) {
      return NextResponse.json({ error: `Unknown webhook channel: ${channel || "(empty)"}.` }, { status: 400 });
    }
    const jobId = String(body.jobId ?? "").trim();
    const job = jobId ? getJob(jobId) : null;
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    // The language inbound leads (and their acknowledgements) are treated as —
    // chosen at creation like the posting/apply-link language toggles.
    const lang = isLocale(String(body.lang ?? "")) ? String(body.lang) : null;
    const webhook = createChannelWebhook({ channel, jobId: job.id, lang }, await currentWorkspace());
    return NextResponse.json({ webhook });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create the webhook." },
      { status: 500 }
    );
  }
}
