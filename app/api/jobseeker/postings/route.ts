import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { listPostings, type ListPostingsOptions } from "@/app/_lib/db/jobseeker-postings";
import { isPostingStatus } from "@/app/_lib/jobseeker/types";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// GET /api/jobseeker/postings?status=&minTotal=&sourceId=&sort=total|posted|seen&cursor=&limit=
// → { rows: JobseekerPostingSummary[], nextCursor } — the seeker's feed (WP4c). The
// projection is the store's summary (no body, no JSON-LD, no full match payload);
// paging is keyset (an opaque cursor), so a scan writing between two pages never
// repeats or skips a row. No `status` = the LIVE feed (not dismissed, not gone).
//
// A filter value outside its closed vocabulary is a 400, not a silent default: a client
// that asked for `status=archived` must learn the vocabulary, not read the live feed
// believing it filtered. APPLY_SELECTION_INVALID is the existing generic "not one of the
// options offered" refusal; the `field` rides beside it.
//
// Operator-gated by the proxy AND re-verified here; the limiter is the real bound in
// open mode. 120/10min per IP — a feed page is a read, paged at 50.

const POSTINGS_MAX_LIMIT = 100;
const POSTINGS_DEFAULT_LIMIT = 50;

const SORTS = ["total", "posted", "seen"] as const;
type Sort = (typeof SORTS)[number];
function isSort(v: unknown): v is Sort {
  return typeof v === "string" && (SORTS as readonly string[]).includes(v);
}

function parseListQuery(params: URLSearchParams): { opts: ListPostingsOptions } | { field: string } {
  const opts: ListPostingsOptions = {};
  const status = params.get("status");
  if (status !== null && status !== "") {
    if (!isPostingStatus(status)) return { field: "status" };
    opts.status = status;
  }
  const minTotal = params.get("minTotal");
  if (minTotal !== null && minTotal !== "") {
    const n = Number(minTotal);
    if (!Number.isFinite(n)) return { field: "minTotal" };
    opts.minTotal = n;
  }
  const sourceId = params.get("sourceId");
  if (sourceId) opts.sourceId = sourceId.slice(0, 64);
  const sort = params.get("sort");
  if (sort !== null && sort !== "") {
    if (!isSort(sort)) return { field: "sort" };
    opts.sort = sort;
  }
  const limit = params.get("limit");
  if (limit !== null && limit !== "") {
    const n = Math.trunc(Number(limit));
    if (!Number.isFinite(n) || n < 1 || n > POSTINGS_MAX_LIMIT) return { field: "limit" };
    opts.limit = n;
  } else {
    opts.limit = POSTINGS_DEFAULT_LIMIT;
  }
  const cursor = params.get("cursor");
  if (cursor) opts.cursor = cursor.slice(0, 512);
  return { opts };
}

export async function GET(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  if (!rateLimit(`jobseeker-postings:${clientIpFrom(request.headers)}`, { limit: 120, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const parsed = parseListQuery(new URL(request.url).searchParams);
    if ("field" in parsed) return jsonRefusal("APPLY_SELECTION_INVALID", 400, { field: parsed.field });
    const ws = await currentWorkspace();
    const { rows, nextCursor } = listPostings(parsed.opts, ws);
    return NextResponse.json({ rows, nextCursor });
  } catch (error) {
    return safeJsonError(error, "api:jobseeker/postings", "JOBSEEKER_STORE_FAILED");
  }
}
