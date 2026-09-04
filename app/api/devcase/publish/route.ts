import { NextRequest, NextResponse } from "next/server";
// The shared by-id owner guard (sibling module - a route file may export only handlers).
import { ownedDevCase } from "../devcase-owned-lifecycle";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { getOpenPosting } from "@/app/_lib/db/devcase";
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
    const channel = body.channel ?? "local";
    // IDEMPOTENCY, stated rather than assumed. The store has deduped since
    // bug-ui-scan-2026-07-09 (createPosting reuses the case+channel's OPEN posting
    // inside an IMMEDIATE transaction), but this route reported every call as a fresh
    // publish: two tabs racing, or a reload mid-request, both got a 200 carrying "here
    // is your new posting" with the same apply token — the client-side single-flight
    // guard in useDevTabActions was the only thing naming the harm, and it only covers
    // ONE tab. Reading the precondition first is what lets the answer be truthful: the
    // second caller is told the case was ALREADY live, on the token that is already out
    // there, instead of being shown a mint that never happened.
    const existing = getOpenPosting(body.caseId, channel, devCase.workspaceId);
    const posting = await getAdapter(channel).publish(devCase);
    // Compared by ID, not by "was there one": a CLOSED posting is deliberately excluded
    // from the dedup, so a re-publish after a close-out is a genuine new posting and
    // must not claim otherwise.
    return NextResponse.json({ posting, alreadyPublished: existing?.id === posting.id });
  } catch (error) {
    // better-sqlite3 + a distribution adapter: the thrown message carries SQLITE_*
    // codes, the absolute db path, or an adapter's upstream body. Log it, answer a code.
    return safeJsonError(error, "api:devcase/publish", "DEVCASE_PUBLISH_FAILED");
  }
}
