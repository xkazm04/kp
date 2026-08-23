import { NextRequest, NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { safeJsonError } from "@/app/_lib/api-response";
import { getRepoScan } from "@/app/_lib/repo-scan";

// App master (P2) — read one repo scan: GET /api/repo-scan/[id] → { scan }.
// The poll target for the intake panel while the background task runs, and the
// read that hands P3 the finished RepoDossier.
//
// What goes on the wire is the row, with ONE thing withheld: `rootPath`. Everything
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
    const { rootPath, ...rest } = scan;
    return NextResponse.json({ scan: { ...rest, isLocal: rootPath !== null } });
  } catch (error) {
    return safeJsonError(error, "api:repo-scan/[id]", "REPO_SCAN_READ_FAILED");
  }
}
