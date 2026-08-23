import { NextRequest, NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { RepoScanRequestError, startRepoScan } from "@/app/_lib/repo-scan";

// App master (P2) — start a repo scan: POST { repoUrl? } | { rootPath? } →
// { scanId, taskId }. The scan runs as the `repo_scan` background task; the
// caller polls GET /api/repo-scan/[id] for the row.
//
// Two gates, and they guard different things. requireOperator keeps a stranger
// from pointing kp at a codebase at all (a no-op in open dev mode, by design). The
// limiter guards the SPEND: every accepted scan is a git clone plus a Python
// subprocess plus, when a provider is configured, an in-repo agent session — the
// same premise as /api/extract-text, one tier tighter because the unit of work is
// far larger. 10/10min is well past an operator composing one App-master role and
// well under a loop.

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    if (!rateLimit(`repo-scan:${clientIpFrom(request.headers)}`, { limit: 10, windowMs: 10 * 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const body = (await request.json().catch(() => ({}))) as { repoUrl?: unknown; rootPath?: unknown };
    // The tenant comes from the SESSION, never the body.
    const ws = await currentWorkspace();
    const { scanId, taskId } = startRepoScan(
      {
        repoUrl: typeof body.repoUrl === "string" ? body.repoUrl : null,
        rootPath: typeof body.rootPath === "string" ? body.rootPath : null,
      },
      ws
    );
    return NextResponse.json({ scanId, taskId });
  } catch (error) {
    // A refused TARGET is the operator's own input problem and carries a message
    // they can act on (the allow-list is not set; the path is outside it; the URL is
    // not a GitHub one). Everything else goes through the generic handler, which
    // does not leak internals.
    if (error instanceof RepoScanRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return safeJsonError(error, "api:repo-scan", "REPO_SCAN_FAILED");
  }
}
