import { NextRequest, NextResponse } from "next/server";
import {
  createChannelWebhook,
  getChannelPullConfig,
  isWebhookChannel,
  listChannelWebhooks,
  setChannelPull,
  type ChannelWebhookRecord,
} from "@/app/_lib/db/channels";
import { getJob, jobVisibleToWorkspace } from "@/app/_lib/db/jobs";
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
    const ws = await currentWorkspace();
    const jobId = String(body.jobId ?? "").trim();
    const job = jobId ? getJob(jobId) : null;
    // getJob is an unscoped by-id point read (jobs-tenancy.test.ts exempts it), so the
    // ROUTE owes the ownership check — same gate and same 404 as GET /api/jobs/[id]. The
    // Add-receiver modal only offers what /api/jobs listed (the shared corpus + this
    // team's own openings), so this changes nothing for the UI; without it a session
    // could bind a receiver to ANOTHER team's authored role by id, and the receivers
    // list — which LEFT JOINs `jobs` unscoped for the title — would then render that
    // team's confidential role title, with its inbound leads filed into the caller's
    // pipeline against it.
    if (!job || !jobVisibleToWorkspace(jobId, ws)) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    // The language inbound leads (and their acknowledgements) are treated as —
    // chosen at creation like the posting/apply-link language toggles.
    const lang = isLocale(String(body.lang ?? "")) ? String(body.lang) : null;
    const webhook = createChannelWebhook({ channel, jobId: job.id, lang }, ws);
    // The `{ webhook }` envelope is the contract the Add-receiver modal reads
    // (`p.webhook.token` drives auto-select). `satisfies` pins it, so renaming or
    // flattening the key is a compile error rather than a silently dead auto-select.
    return NextResponse.json({ webhook } satisfies { webhook: ChannelWebhookRecord });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create the webhook." },
      { status: 500 }
    );
  }
}

/**
 * Configure the PULL half of a receiver (L0 — docs/concepts/local-first-edge.md §3.1).
 *
 * A receiver is push-only until a `pullUrl` is set; with one, the clock also asks the
 * source what arrived while this machine was off, and files it through the same
 * intake. That is the cheapest complete answer to "my studio is closed at 22:00" for
 * any source that can be listed.
 *
 * Secret semantics are the repo's stored-credential contract, and the response
 * carries `hasSecret` rather than the token:
 *   • omitted → keep · "" → clear · any string → replace (encrypted at rest)
 *
 * Scoped to the owning team by setChannelPull: knowing a token is not enough to
 * point another team's receiver at your server.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { token?: unknown; pullUrl?: unknown; pullSecret?: unknown };
    const token = String(body.token ?? "").trim();
    if (!token) return NextResponse.json({ error: "token is required." }, { status: 400 });
    const pullUrl = body.pullUrl === null || body.pullUrl === undefined || body.pullUrl === "" ? null : String(body.pullUrl);
    const secret = body.pullSecret === undefined ? undefined : String(body.pullSecret);
    // A malformed/unsafe URL throws out of the store's validation — answer 400 with
    // the reason rather than a 500, since it is the caller's input that is wrong.
    const ws = await currentWorkspace();
    let ok: boolean;
    try {
      ok = setChannelPull(token, { url: pullUrl, secret }, ws);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid pull URL." }, { status: 400 });
    }
    // Same answer as an unknown token, for the same reason the receiver gives it:
    // a caller must not be able to probe which tokens exist in another team.
    if (!ok) return NextResponse.json({ error: "Webhook not found." }, { status: 404 });
    return NextResponse.json({ pull: getChannelPullConfig(token, ws) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update the webhook." },
      { status: 500 }
    );
  }
}
