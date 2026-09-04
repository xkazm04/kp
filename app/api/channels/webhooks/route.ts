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
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireOrgCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { isLocale } from "@/i18n/locales";


// E3 (Erika gap) — recruiter management of inbound channel webhooks. Each
// webhook binds one (channel, job, candidate-language) and yields the public
// receiver URL /api/channels/inbound/[token]. The RECEIVER is the public,
// token-gated boundary; these are its ADMINISTRATION doors.
//
// AUTHORIZATION (/perfect wave 27, api-comms). "Listing/creating is a recruiter
// surface (trusted environment)" was the whole gate: currentWorkspace() resolves a
// TENANT, it does not decide AUTHORITY, and in open mode (KP_OPERATOR_PASSWORD unset)
// every caller — an anonymous demo cookie included — satisfied it. What these writes
// actually do is INSTALLATION wiring: POST mints a permanent public ingress token bound
// to a role, PATCH stores a URL AND A SECRET that the clock later fetches on this
// server's behalf (an outbound reach the operator owns, not the recruiter), and DELETE
// permanently kills a live lead intake. That is org administration — `org:manage`,
// resolved org-wide, which recruiters and viewers do not hold.
//
// Per-IP budget on the writes. They are operator-gated, and open mode makes that gate a
// documented no-op for the ENTIRE API, so the limiter is the real bound: without it
// POST was an unmetered public-token mint and a probe for which role ids exist (404 vs
// 200), and PATCH was an unmetered oracle for the stored-URL SSRF guard, one candidate
// host at a time. 60/10min sits far above a recruiter wiring receivers by hand.
const RECEIVER_WRITE_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };

export async function GET() {
  return NextResponse.json({ webhooks: listChannelWebhooks(await currentWorkspace()) });
}

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("org:manage", requireOrgCapability);
  if (under) return under;
  // AFTER the authority gates, so a refused caller never spends the budget, and before
  // any parsing or store work.
  if (!rateLimit(`channel-receiver:${clientIpFrom(request.headers)}`, RECEIVER_WRITE_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const body = (await request.json().catch(() => ({}))) as {
      channel?: unknown;
      jobId?: unknown;
      lang?: unknown;
    };
    const channel = String(body.channel ?? "");
    if (!isWebhookChannel(channel)) {
      // The rejected value rides as DATA, not inside the message: the client resolves
      // the code and never renders the server's English string (api-contracts.md 1.1).
      return jsonRefusal("CHANNEL_UNKNOWN", 400, { channel: channel || null });
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
      return jsonRefusal("CHANNEL_JOB_NOT_FOUND", 404);
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
    // better-sqlite3 detail and the absolute db path used to ride the wire here, and
    // the Add-receiver modal painted it verbatim in every locale.
    return safeJsonError(error, "api:channels/webhooks", "CHANNEL_WEBHOOK_CREATE_FAILED");
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
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("org:manage", requireOrgCapability);
  if (under) return under;
  if (!rateLimit(`channel-receiver:${clientIpFrom(request.headers)}`, RECEIVER_WRITE_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const body = (await request.json().catch(() => ({}))) as { token?: unknown; pullUrl?: unknown; pullSecret?: unknown };
    const token = String(body.token ?? "").trim();
    if (!token) return jsonRefusal("CHANNEL_TOKEN_REQUIRED", 400);
    const pullUrl = body.pullUrl === null || body.pullUrl === undefined || body.pullUrl === "" ? null : String(body.pullUrl);
    const secret = body.pullSecret === undefined ? undefined : String(body.pullSecret);
    // A malformed/unsafe URL throws out of the store's validation — answer 400 with
    // the reason rather than a 500, since it is the caller's input that is wrong.
    const ws = await currentWorkspace();
    let ok: boolean;
    try {
      ok = setChannelPull(token, { url: pullUrl, secret }, ws);
    } catch (e) {
      // The validator's own sentence names the refused host and field — but this catch
      // also covers the encrypted STORE WRITE inside setChannelPull, whose thrown
      // message carries SQLITE_* detail and the absolute db path. The two are
      // indistinguishable from here, so the reason goes to the server log and the
      // caller gets the code (api-contracts.md 1.1). Narrowing this to a 400 for a
      // typed validation error and a 500 otherwise needs a typed error out of
      // db/channels.ts — recorded, not guessed at here.
      console.error("[api:channels/webhooks] CHANNEL_PULL_URL_INVALID", e);
      return jsonRefusal("CHANNEL_PULL_URL_INVALID", 400);
    }
    // Same answer as an unknown token, for the same reason the receiver gives it:
    // a caller must not be able to probe which tokens exist in another team.
    if (!ok) return jsonRefusal("CHANNEL_WEBHOOK_NOT_FOUND", 404);
    return NextResponse.json({ pull: getChannelPullConfig(token, ws) });
  } catch (error) {
    return safeJsonError(error, "api:channels/webhooks", "CHANNEL_WEBHOOK_UPDATE_FAILED");
  }
}
