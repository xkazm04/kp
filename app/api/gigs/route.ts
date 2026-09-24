import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { createManualGig, listGigs } from "@/app/_lib/db/gigs";
import { listGigAttemptsForGig } from "@/app/_lib/db/gigs-attempts";
import { listGigSpecialists } from "@/app/_lib/db/gigs-specialists";
import { qualifyAndMatch } from "@/app/_lib/gigs/qualify";
import { scanGigForHoneypots } from "@/app/_lib/gigs/suspect";
import { GIG_STATUSES, isGigArena, isGigStatus, type GigAttempt, type GigReward, type GigStatus } from "@/app/_lib/gigs/types";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// /api/gigs - the Gig desk's list and the operator's "forward a brief" door.
//
// GET  ?arena=&status=a,b&before=<updatedAt>&limit=<=200 -> { gigs, specialists,
//      attemptsByGig: { [gigId]: latest GigAttempt } }. Newest-touched first; `before` is
//      the keyset cursor (the last row's updatedAt).
// POST { arena, url, title, org?, reward?, deadlineAt?, bodyText, tags? } -> the brief
//      runs the deterministic honeypot scan FIRST (a forwarded brief is as untrusted as a
//      scanned one), is stored (createManualGig - the same brief twice lands once), and
//      is qualified like a scanned listing (qualify.ts). 201 when created, 200 when the
//      brief was already on the desk.
//
// Operator-gated by the proxy AND re-verified here; the POST also asks pipeline:write
// and self-limits per IP (open mode makes the operator gate a no-op).

const MAX_BODY_CHARS = 60_000;
const MAX_TITLE_CHARS = 300;

export async function GET(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    const q = new URL(request.url).searchParams;
    const arenaParam = q.get("arena");
    if (arenaParam && !isGigArena(arenaParam)) return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "arena" });
    const statusParam = q.get("status");
    let statuses: GigStatus[] | undefined;
    if (statusParam) {
      const parts = statusParam.split(",").map((s) => s.trim()).filter(Boolean);
      if (!parts.every(isGigStatus)) return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "status", allowed: GIG_STATUSES });
      statuses = parts as GigStatus[];
    }
    const before = q.get("before");
    if (before && !Number.isFinite(Date.parse(before))) return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "before" });
    const limitRaw = q.get("limit");
    const limit = limitRaw === null ? 50 : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "limit" });

    const gigs = listGigs(ws, { arena: isGigArena(arenaParam) ? arenaParam : undefined, statuses, before: before ?? undefined, limit });
    const attemptsByGig: Record<string, GigAttempt> = {};
    for (const gig of gigs) {
      const attempts = listGigAttemptsForGig(ws, gig.id);
      const latest = attempts[attempts.length - 1];
      if (latest) attemptsByGig[gig.id] = latest;
    }
    return NextResponse.json({ gigs, specialists: listGigSpecialists(ws), attemptsByGig });
  } catch (error) {
    return safeJsonError(error, "api:gigs", "GIG_STORE_FAILED");
  }
}

type ForwardBody = {
  arena?: unknown;
  url?: unknown;
  title?: unknown;
  org?: unknown;
  reward?: unknown;
  deadlineAt?: unknown;
  bodyText?: unknown;
  tags?: unknown;
};

/** `{ amount?, currency?, text }` or a bare number. Null when absent; `false` when malformed. */
function parseReward(v: unknown): GigReward | null | false {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? { amount: v, currency: null, text: String(v) } : false;
  if (typeof v !== "object" || Array.isArray(v)) return false;
  const r = v as { amount?: unknown; currency?: unknown; text?: unknown };
  const amount = r.amount === undefined || r.amount === null ? null : typeof r.amount === "number" && Number.isFinite(r.amount) && r.amount >= 0 ? r.amount : false;
  if (amount === false) return false;
  const currency = typeof r.currency === "string" && r.currency.trim() ? r.currency.trim().slice(0, 16) : null;
  const text = typeof r.text === "string" && r.text.trim() ? r.text.trim().slice(0, 200) : amount !== null ? `${amount}${currency ? ` ${currency}` : ""}` : "";
  if (!text) return false;
  return { amount, currency, text };
}

export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  // THROTTLE before the body is read: each forward is a write plus a qualification pass.
  if (!rateLimit(`gigs-forward:${clientIpFrom(request.headers)}`, { limit: 30, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const body = (await request.json().catch(() => ({}))) as ForwardBody;
    if (!isGigArena(body.arena)) return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "arena" });
    const url = typeof body.url === "string" ? body.url.trim() : "";
    // Required: the operator sends under their own account, and the desk links to where.
    if (!/^https?:\/\/\S+$/i.test(url) || url.length > 2000) return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "url" });
    const title = typeof body.title === "string" ? body.title.trim().slice(0, MAX_TITLE_CHARS) : "";
    if (!title) return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "title" });
    const bodyText = typeof body.bodyText === "string" ? body.bodyText.slice(0, MAX_BODY_CHARS) : "";
    if (!bodyText.trim()) return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "bodyText" });
    const reward = parseReward(body.reward);
    if (reward === false) return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "reward" });
    let deadlineAt: string | null = null;
    if (body.deadlineAt !== undefined && body.deadlineAt !== null && body.deadlineAt !== "") {
      const t = typeof body.deadlineAt === "string" ? Date.parse(body.deadlineAt) : NaN;
      if (!Number.isFinite(t)) return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "deadlineAt" });
      deadlineAt = new Date(t).toISOString();
    }
    const org = typeof body.org === "string" && body.org.trim() ? body.org.trim() : null;
    const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : [];

    const ws = await currentWorkspace();
    // The honeypot scan runs on the brief exactly as a scanned listing's does: a brief the
    // operator pasted is still text a stranger wrote.
    const suspectReasons = scanGigForHoneypots({ bodyText, bodyHtml: null, title });
    const { gig, created } = createManualGig(ws, { arena: body.arena, url, title, org, reward, deadlineAt, bodyText, tags, suspectReasons });
    const qualified = qualifyAndMatch(ws, gig.id);
    return NextResponse.json(
      { gig: qualified.ok ? qualified.gig : gig, created, suspectReasons, qualification: qualified.ok ? qualified.qualification : null },
      { status: created ? 201 : 200 }
    );
  } catch (error) {
    return safeJsonError(error, "api:gigs", "GIG_STORE_FAILED");
  }
}
