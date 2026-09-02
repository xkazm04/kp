import { NextRequest, NextResponse } from "next/server";
// The shared by-id owner guard (sibling module - a route file may export only handlers).
import { ownedDevCase } from "../devcase-owned-lifecycle";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { getAdapter } from "@/app/_lib/distribution";
import { safeJsonError } from "@/app/_lib/api-response";


// OUT: publish an approved role+case through a distribution channel (local stub by default).
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { caseId?: string; channel?: string };
    if (!body.caseId) return NextResponse.json({ error: "caseId is required." }, { status: 400 });
    const ws = await currentWorkspace();
    // getDevCase is a by-id point read (globally-unique id), so ownership is checked
    // here — through the SHARED guard all six by-id doors now use. Unguarded, a known
    // case id from another team published through this door: createPosting inherits the
    // CASE's workspace, so a first publish minted a live apply token inside THEIR studio
    // and a re-publish re-selected their existing OPEN posting — handing its token back
    // in this response. That token is the bearer credential for their candidate surface
    // (it starts sessions, spends their chat budget, injects submissions).
    const devCase = ownedDevCase(body.caseId, ws);
    if (!devCase) return NextResponse.json({ error: "case not found" }, { status: 404 });
    const posting = await getAdapter(body.channel ?? "local").publish(devCase);
    return NextResponse.json({ posting });
  } catch (error) {
    // better-sqlite3 + a distribution adapter: the thrown message carries SQLITE_*
    // codes, the absolute db path, or an adapter's upstream body. Log it, answer a code.
    return safeJsonError(error, "api:devcase/publish", "DEVCASE_PUBLISH_FAILED");
  }
}
