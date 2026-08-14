import { NextResponse } from "next/server";
import { attentionCounts } from "@/app/_lib/attention";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { safeJsonError } from "@/app/_lib/api-response";


// SHELL2 — the sidebar badge counts. Read-only, tiny payload, polled by the
// shell (mount + live-refresh + a visibility-gated 60s interval). Scoped to the
// SESSION's workspace: without it every badge reported the default tenant's
// backlog to a recruiter signed into any other team.
export async function GET() {
  try {
    return NextResponse.json(attentionCounts(await currentWorkspace()));
  } catch (error) {
    return safeJsonError(error, "api:attention", "ATTENTION_FAILED");
  }
}
