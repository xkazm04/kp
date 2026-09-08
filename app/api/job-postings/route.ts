import { NextResponse } from "next/server";
import {
  getJobPosting,
  insertJobPosting,
  jobPostingSummary,
  listJobPostings,
  seedJobPostingsCorpus,
} from "@/app/_lib/db/job-postings";
import { fetchPostingText } from "@/app/_lib/job-posting-fetch";
import { isOffline } from "@/app/_lib/offline";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { POSTING_MAX_CHARS, POSTING_MIN_CHARS } from "./posting-import-limits";

// The posting corpus (db/job-postings.ts, docs/features/intake/README.md).
// GET  — this workspace's posting ledger, filterable by free text and role family.
// POST — import postings: the two bundled corpora ({source:"seed"}, once per
//        workspace), a pasted advertisement, or a fetched careers page.
// Operator-internal on both verbs; NOT on the public allow-list.

export async function GET(request: Request) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const limitParam = Number(url.searchParams.get("limit"));
    const ws = await currentWorkspace();
    const postings = listJobPostings(ws, {
      q: url.searchParams.get("q") ?? undefined,
      roleFamily: url.searchParams.get("roleFamily") ?? undefined,
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
    });
    return NextResponse.json({ postings });
  } catch (error) {
    return safeJsonError(error, "api:job-postings", "JOB_LIST_FAILED");
  }
}

type ImportBody = {
  source?: unknown;
  title?: unknown;
  text?: unknown;
  company?: unknown;
  lang?: unknown;
  roleFamily?: unknown;
  seniority?: unknown;
  url?: unknown;
};

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export async function POST(request: Request) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const body = (await request.json().catch(() => ({}))) as ImportBody;
    const source = str(body.source);

    // CHEAP REFUSALS FIRST — a request that was never going to import anything costs
    // no budget. POSTING_TEXT_REQUIRED carries an unrecognized `source` too: the only
    // bodies this door accepts are ones that carry posting text or a URL to some, and
    // the registry has no generic body-shape refusal (a new code owes four catalogs).
    if (source !== "seed" && source !== "paste" && source !== "url") {
      return jsonRefusal("POSTING_TEXT_REQUIRED", 400);
    }
    const pastedText = source === "paste" ? str(body.text) : "";
    if (source === "paste" && pastedText.length < POSTING_MIN_CHARS) {
      return jsonRefusal("POSTING_TEXT_REQUIRED", 400);
    }
    let target: URL | null = null;
    if (source === "url") {
      try {
        target = new URL(str(body.url));
      } catch {
        target = null; /* unparseable — refused just below, never handed to fetch */
      }
      // 400, not the 502 the same code carries after a real attempt: nothing was
      // fetched, and the fault is in the request. One code because the operator's next
      // move is identical — check the link, or paste the text instead.
      if (!target || (target.protocol !== "http:" && target.protocol !== "https:")) {
        return jsonRefusal("POSTING_FETCH_FAILED", 400);
      }
      // Refuse egress UP FRONT so the operator gets a DECISION in their own language.
      // The global fetch guard (offline.ts) would also block this, but as a thrown
      // network error — an accident, not an answer.
      if (isOffline()) return jsonRefusal("POSTING_OFFLINE", 503);
    }

    // THROTTLE: below this line the request either fetches a remote page or writes
    // ~220 corpus rows. Per IP — operator-gated, but in open mode (no
    // KP_OPERATOR_PASSWORD) that gate is a no-op for the whole API. Pinned in
    // app/api/rate-limit-contract.test.ts.
    if (!rateLimit(`job-postings-import:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 10 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    const ws = await currentWorkspace();

    if (source === "seed") {
      // One-shot per workspace (seed mark), so a second call reports inserted: 0
      // rather than re-importing. No postings echoed back: the ledger is 220 rows
      // and the caller re-reads GET for it.
      const counts = seedJobPostingsCorpus(ws);
      return NextResponse.json({ ...counts, postings: [] });
    }

    let title = str(body.title);
    let text = pastedText;
    let fetchedAt: string | null = null;
    if (source === "url" && target) {
      const fetched = await fetchPostingText(target.href).catch(() => null);
      // A fetch that threw, or a page whose readable text is a stub (JS-only careers
      // sites render nothing here), is ONE refusal: the page yielded no posting.
      if (!fetched || fetched.text.trim().length < POSTING_MIN_CHARS) {
        return jsonRefusal("POSTING_FETCH_FAILED", 502);
      }
      text = fetched.text.trim();
      title = title || fetched.title || target.hostname;
      fetchedAt = new Date().toISOString();
    }

    const { id, inserted } = insertJobPosting(
      {
        source: source === "url" ? "url" : "paste",
        sourceRef: source === "url" && target ? target.href : null,
        title: title || "Untitled posting",
        company: str(body.company) || null,
        roleFamily: str(body.roleFamily) || null,
        seniority: str(body.seniority) || null,
        lang: str(body.lang) || null,
        bodyText: text.slice(0, POSTING_MAX_CHARS),
        fetchedAt,
      },
      ws
    );
    const posting = getJobPosting(id, ws);
    return NextResponse.json({
      inserted: inserted ? 1 : 0,
      skipped: inserted ? 0 : 1,
      postings: posting ? [jobPostingSummary(posting)] : [],
    });
  } catch (error) {
    return safeJsonError(error, "api:job-postings", "JOB_INGEST_FAILED");
  }
}
