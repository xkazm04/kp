import { NextRequest, NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { safeJsonError } from "@/app/_lib/api-response";
import { getRepoScan } from "@/app/_lib/repo-scan";

// App master (P2) — read one repo scan: GET /api/repo-scan/[id] → { scan }.
// The poll target for the intake panel while the background task runs, and the
// read that hands P3 the finished RepoDossier.
//
// What goes on the wire is an ALLOW-LIST, not the row. Everything
// else here is either the operator's own input or a dossier they asked for, but the
// resolved local path is a fact about the SERVER's filesystem — it is the real path
// after symlink resolution, so it can differ from what was typed and can disclose
// where the operator's checkouts live. The dossier's own `repo.rootPath` carries it
// for a local scan (that is the binding an AppMasterSpec needs), which is why this
// is a projection choice rather than a redaction claim: the response tells the
// caller a local path was scanned without echoing the server's resolution of it.

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const scan = getRepoScan(id, await currentWorkspace());
    // A scan in another tenant is indistinguishable from one that never existed.
    if (!scan) return NextResponse.json({ error: "Repo scan not found." }, { status: 404 });
    // An explicit ALLOW-LIST, never a spread of the row. A spread is an allow-list
    // written backwards: every column a later migration adds to `repo_scans` is on
    // the wire by default, and three already were.
    //
    //   `error`          — the thrown message, which for a clone failure carries
    //                      git's last 200 stderr bytes (a private remote's host,
    //                      branch and auth chatter). Nothing renders it: the panel
    //                      resolves `errorCode` in the reader's language.
    //   `fallbackReason` — the raw "<ExceptionType>: <message>" line behind a
    //                      fallback: English, unbounded, able to quote provider
    //                      output. Its CLASS (`fallbackClass`) goes out instead.
    //   `rootPath`       — the server's resolved filesystem path (see above); the
    //                      response says a local path was scanned (`isLocal`)
    //                      without echoing the server's resolution of it.
    //   `workspaceId`    — the caller's own tenant, which it did not send and has
    //                      no use for; an id is not a fact a response owes back.
    //
    // Widening this list is a decision (repo-scan-detail-route.test.ts enumerates
    // it), which is the whole difference from the shape it replaces.
    return NextResponse.json({
      scan: {
        id: scan.id,
        repoUrl: scan.repoUrl,
        status: scan.status,
        source: scan.source,
        dossier: scan.dossier,
        errorCode: scan.errorCode,
        fallbackClass: scan.fallbackClass,
        isLocal: scan.rootPath !== null,
        createdAt: scan.createdAt,
        updatedAt: scan.updatedAt,
      },
    });
  } catch (error) {
    return safeJsonError(error, "api:repo-scan/[id]", "REPO_SCAN_READ_FAILED");
  }
}
