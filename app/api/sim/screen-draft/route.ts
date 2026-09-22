import { NextRequest, NextResponse } from "next/server";
import { resolveSimEntry, setSimApproval } from "@/app/_lib/sim-entry";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { namespaceTranslator } from "@/app/_lib/catalog-translator";
import { resolveCommsLocale } from "@/app/_lib/comms-locale";
import { buildSimScreenDraft } from "@/app/features/shell/simulation/simDrafts";


// Deterministic screening recommendation for the simulation — NO LLM. Sets the
// screening_review approval so a real card appears in the Decisions queue for the
// driver to click "Advance" on (the genuine human-decision gate).
export async function POST(request: NextRequest) {
  try {
    const { entryId } = (await request.json()) as { entryId?: string };
    if (!entryId) return jsonRefusal("SIM_ENTRY_REQUIRED", 400);
    // Tenant: look the entry up in the CALLER'S team. Unscoped, this read only ever
    // found DEFAULT-team entries, so on any other team the sim's own freshly created
    // entry came back null and the run died on "Pipeline entry not found" at the
    // screening step — and the scoping doubles as the authorization check, since a
    // stranger's entryId simply doesn't resolve.
    // Demo corpus only: resolveSimEntry admits an entry in the CALLER'S team whose job
    // title carries the (SIM) marker, and nothing else. The team scoping keeps a
    // stranger's id from resolving; the marker keeps a REAL candidate's row out of
    // this ungated door (a real id 404s exactly like a missing one). See sim-entry.ts.
    const workspaceId = await currentWorkspace();
    const entry = resolveSimEntry(entryId, workspaceId);
    if (!entry) return jsonRefusal("SIM_ENTRY_NOT_FOUND", 404);

    // The card the recruiter reads in Decisions, composed from the CATALOG rather
    // than as an English literal (simDrafts.ts). Locale precedence is the one every
    // candidate-facing artifact uses — the entry's own language, else its TEAM's
    // default (resolveCommsLocale) — so a cs/de/fr workspace no longer watches a
    // localized tour hand it an English recommendation.
    const draft = buildSimScreenDraft(
      await namespaceTranslator(resolveCommsLocale(entry.locale, entry.workspaceId), "simulation"),
      entry.jobTitle
    );
    // The entry we just read is the tenant authority for the write (same row, same
    // team) — an unscoped setApproval matched nothing off the default team, so the
    // Decisions queue never got its card and the walk stalled with nothing to advance.
    setSimApproval(entry, "screening_review", JSON.stringify(draft));
    return NextResponse.json({ ok: true, draft });
  } catch (error) {
    return safeJsonError(error, "api:sim/screen-draft", "SIM_SCREEN_DRAFT_FAILED");
  }
}
